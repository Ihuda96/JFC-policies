import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const requiredEnv = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);

const libreOfficeBinary = process.env.LIBREOFFICE_BINARY ?? "soffice";
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 15000);
const maxAttempts = Number(process.env.WORKER_MAX_ATTEMPTS ?? 3);

function log(message, data = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), message, ...data }));
}

async function claimJob() {
  const { data: jobs, error } = await supabase
    .from("file_processing_jobs")
    .select("*, policy_files!file_processing_jobs_file_id_fkey(*)")
    .eq("job_type", "docx_to_pdf_preview")
    .eq("status", "queued")
    .lt("attempts", maxAttempts)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    throw error;
  }

  const job = jobs?.[0];
  if (!job) {
    return null;
  }

  const { data: claimed, error: claimError } = await supabase
    .from("file_processing_jobs")
    .update({
      status: "processing",
      attempts: job.attempts + 1,
      started_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", job.id)
    .eq("status", "queued")
    .select("*, policy_files!file_processing_jobs_file_id_fkey(*)")
    .maybeSingle();

  if (claimError) {
    throw claimError;
  }

  return claimed;
}

async function convertDocxToPdf(job) {
  const originalFile = job.policy_files;
  if (!originalFile) {
    throw new Error("Processing job is missing source policy file metadata.");
  }

  const workdir = await mkdtemp(join(tmpdir(), "jfc-docx-"));
  const inputName = basename(originalFile.file_name).replace(/[^\w.\-]+/g, "-") || "source.docx";
  const inputPath = join(workdir, inputName.endsWith(".docx") ? inputName : `${inputName}.docx`);

  try {
    const { data: sourceBytes, error: downloadError } = await supabase.storage
      .from(originalFile.bucket_id)
      .download(originalFile.storage_path);

    if (downloadError || !sourceBytes) {
      throw downloadError ?? new Error("Source DOCX download returned no bytes.");
    }

    await writeFile(inputPath, Buffer.from(await sourceBytes.arrayBuffer()));

    await execFileAsync(libreOfficeBinary, [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      workdir,
      inputPath,
    ], {
      timeout: Number(process.env.LIBREOFFICE_TIMEOUT_MS ?? 120000),
    });

    const outputPath = inputPath.replace(/\.docx$/i, ".pdf");
    const pdfBytes = await readFile(outputPath);
    const outputStoragePath = originalFile.storage_path.replace(/\.docx$/i, ".pdf");
    const outputFileName = originalFile.file_name.replace(/\.docx$/i, ".pdf");

    const { error: uploadError } = await supabase.storage
      .from("policy-previews")
      .upload(outputStoragePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { error: insertError } = await supabase
      .from("policy_files")
      .upsert(
        {
          policy_id: job.policy_id,
          version_id: job.version_id,
          bucket_id: "policy-previews",
          storage_path: outputStoragePath,
          file_kind: "preview",
          file_name: outputFileName,
          content_type: "application/pdf",
          file_size: pdfBytes.byteLength,
          preview_ready: true,
          created_by: originalFile.created_by,
        },
        {
          onConflict: "bucket_id,storage_path",
        },
      );

    if (insertError) {
      throw insertError;
    }

    const { error: completeError } = await supabase
      .from("file_processing_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", job.id);

    if (completeError) {
      throw completeError;
    }

    log("converted docx preview", { job_id: job.id, output: outputStoragePath });
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

async function failJob(job, error) {
  const message = error instanceof Error ? error.message : String(error);
  const terminal = job.attempts >= maxAttempts;
  const { error: updateError } = await supabase
    .from("file_processing_jobs")
    .update({
      status: terminal ? "failed" : "queued",
      last_error: message,
      started_at: null,
      completed_at: terminal ? new Date().toISOString() : null,
    })
    .eq("id", job.id);

  if (updateError) {
    log("failed to update errored job", { job_id: job.id, error: updateError.message });
  }

  log("docx conversion failed", { job_id: job.id, terminal, error: message });
}

async function runOnce() {
  const job = await claimJob();
  if (!job) {
    return false;
  }

  try {
    await convertDocxToPdf(job);
  } catch (error) {
    await failJob(job, error);
  }

  return true;
}

async function main() {
  const once = process.argv.includes("--once");
  if (once) {
    await runOnce();
    return;
  }

  log("docx preview worker started", { pollIntervalMs, maxAttempts });
  for (;;) {
    const processed = await runOnce();
    if (!processed) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
