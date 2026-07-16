import { z } from "zod";
import { assertSupabase, errorMessage } from "./supabase";
import type { Policy, PolicyFile } from "./types";

const uploadSchema = z.object({
  note: z.string().max(1000).optional(),
  title: z.string().max(240).optional(),
});

const allowedTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function safeFileName(name: string) {
  const normalized = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-");

  return normalized || `policy-file-${Date.now()}`;
}

function titleFromFile(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
}

function contentTypeFor(file: File) {
  if (file.type) {
    return file.type;
  }

  if (file.name.toLowerCase().endsWith(".pdf")) {
    return "application/pdf";
  }

  return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

export async function uploadPolicyDraft(input: {
  file: File;
  note?: string;
  title?: string;
}) {
  const parsed = uploadSchema.parse({ note: input.note, title: input.title });
  const supabase = assertSupabase();
  const contentType = contentTypeFor(input.file);

  if (!allowedTypes.has(contentType)) {
    throw new Error("الصيغ المسموحة هي PDF و DOCX فقط.");
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("يجب تسجيل الدخول قبل رفع السياسة.");
  }

  const policyId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const fileName = safeFileName(input.file.name);
  const storagePath = `${user.id}/${policyId}/${versionId}/${fileName}`;
  const policyTitle = parsed.title?.trim() || titleFromFile(input.file.name);

  const { error: policyError } = await supabase.from("policies").insert({
    id: policyId,
    title: policyTitle,
    status: "draft",
    owner_id: user.id,
    created_by: user.id,
    document_type: "policy",
  });

  if (policyError) {
    throw policyError;
  }

  const { error: versionError } = await supabase.from("policy_versions").insert({
    id: versionId,
    policy_id: policyId,
    version_number: 1,
    status: "draft",
    source_file_name: input.file.name,
    submitted_by: user.id,
    manager_note: parsed.note ?? null,
  });

  if (versionError) {
    throw versionError;
  }

  const { error: uploadError } = await supabase.storage
    .from("policy-originals")
    .upload(storagePath, input.file, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  const { error: fileError } = await supabase.from("policy_files").insert({
    id: fileId,
    policy_id: policyId,
    version_id: versionId,
    bucket_id: "policy-originals",
    storage_path: storagePath,
    file_kind: "original",
    file_name: input.file.name,
    content_type: contentType,
    file_size: input.file.size,
    created_by: user.id,
  });

  if (fileError) {
    throw fileError;
  }

  await supabase.from("file_processing_jobs").insert({
    policy_id: policyId,
    version_id: versionId,
    file_id: fileId,
    job_type: contentType === "application/pdf" ? "pdf_text_extraction" : "docx_to_pdf_preview",
    status: "queued",
  });

  return { policyId, versionId, fileId };
}

export async function uploadRevision(input: {
  policy: Policy;
  file: File;
  note?: string;
}) {
  const supabase = assertSupabase();
  const contentType = contentTypeFor(input.file);

  if (!allowedTypes.has(contentType)) {
    throw new Error("الصيغ المسموحة هي PDF و DOCX فقط.");
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("يجب تسجيل الدخول قبل رفع النسخة المعدلة.");
  }

  const { data: versions, error: versionQueryError } = await supabase
    .from("policy_versions")
    .select("version_number")
    .eq("policy_id", input.policy.id)
    .order("version_number", { ascending: false })
    .limit(1);

  if (versionQueryError) {
    throw versionQueryError;
  }

  const nextVersionNumber = Number(versions?.[0]?.version_number ?? 0) + 1;
  const versionId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const fileName = safeFileName(input.file.name);
  const storagePath = `${user.id}/${input.policy.id}/${versionId}/${fileName}`;

  const { error: versionError } = await supabase.from("policy_versions").insert({
    id: versionId,
    policy_id: input.policy.id,
    version_number: nextVersionNumber,
    status: "draft",
    source_file_name: input.file.name,
    submitted_by: user.id,
    manager_note: input.note ?? null,
    change_summary: input.note ?? null,
  });

  if (versionError) {
    throw versionError;
  }

  const { error: uploadError } = await supabase.storage
    .from("policy-originals")
    .upload(storagePath, input.file, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  const { error: fileError } = await supabase.from("policy_files").insert({
    id: fileId,
    policy_id: input.policy.id,
    version_id: versionId,
    bucket_id: "policy-originals",
    storage_path: storagePath,
    file_kind: "original",
    file_name: input.file.name,
    content_type: contentType,
    file_size: input.file.size,
    created_by: user.id,
  });

  if (fileError) {
    throw fileError;
  }

  await supabase.from("file_processing_jobs").insert({
    policy_id: input.policy.id,
    version_id: versionId,
    file_id: fileId,
    job_type: contentType === "application/pdf" ? "pdf_text_extraction" : "docx_to_pdf_preview",
    status: "queued",
  });

  return { versionId, fileId };
}

export async function uploadPreviewPdf(input: {
  policyId: string;
  versionId: string;
  file: File;
}) {
  const supabase = assertSupabase();
  const contentType = contentTypeFor(input.file);

  if (contentType !== "application/pdf") {
    throw new Error("ملف المعاينة الرسمي يجب أن يكون PDF.");
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("يجب تسجيل الدخول قبل رفع ملف المعاينة.");
  }

  const fileId = crypto.randomUUID();
  const fileName = safeFileName(input.file.name);
  const storagePath = `${user.id}/${input.policyId}/${input.versionId}/preview-${Date.now()}-${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from("policy-previews")
    .upload(storagePath, input.file, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  const { error: fileError } = await supabase.from("policy_files").insert({
    id: fileId,
    policy_id: input.policyId,
    version_id: input.versionId,
    bucket_id: "policy-previews",
    storage_path: storagePath,
    file_kind: "preview",
    file_name: input.file.name,
    content_type: contentType,
    file_size: input.file.size,
    preview_ready: true,
    created_by: user.id,
  });

  if (fileError) {
    throw fileError;
  }

  return { fileId };
}

export async function submitPolicyVersion(
  policyId: string,
  versionId: string,
  note?: string,
) {
  const supabase = assertSupabase();
  const { error } = await supabase.rpc("submit_policy_version", {
    p_policy_id: policyId,
    p_version_id: versionId,
    p_note: note ?? null,
  });

  if (error) {
    throw error;
  }
}

export async function returnPolicyForRevision(input: {
  policyId: string;
  versionId: string;
  comment: string;
  pageNumber?: number | null;
}) {
  const supabase = assertSupabase();
  const { error } = await supabase.rpc("return_policy_for_revision", {
    p_policy_id: input.policyId,
    p_version_id: input.versionId,
    p_comment: input.comment,
    p_page_number: input.pageNumber ?? null,
  });

  if (error) {
    throw error;
  }
}

export async function approvePolicyVersion(policyId: string, versionId: string) {
  const supabase = assertSupabase();
  const { error } = await supabase.rpc("approve_policy_version", {
    p_policy_id: policyId,
    p_version_id: versionId,
  });

  if (error) {
    throw error;
  }
}

export async function signedFileUrl(
  file: Pick<PolicyFile, "id" | "bucket_id" | "storage_path">,
  action: "preview" | "download" | "print",
) {
  const supabase = assertSupabase();
  const { error: auditError } = await supabase.rpc("track_file_access", {
    p_file_id: file.id,
    p_action: action,
  });

  if (auditError) {
    throw auditError;
  }

  const { data, error } = await supabase.storage
    .from(file.bucket_id)
    .createSignedUrl(file.storage_path, 300);

  if (error || !data?.signedUrl) {
    throw error ?? new Error("تعذر إنشاء رابط ملف مؤقت.");
  }

  return data.signedUrl;
}

export async function markNotificationRead(notificationId: string) {
  const supabase = assertSupabase();
  const { error } = await supabase.rpc("mark_notification_read", {
    p_notification_id: notificationId,
  });

  if (error) {
    throw error;
  }
}

export function readableWorkflowError(error: unknown) {
  return errorMessage(error);
}
