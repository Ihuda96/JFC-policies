import { z } from "zod";
import { extractPolicyCode } from "./documentCode";
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

  // Read the full policy code from the document so the policy classifies
  // automatically and shows its full number without a separate backend step.
  const detectedCode = await extractPolicyCode(input.file);

  const { error: policyError } = await supabase.from("policies").insert({
    id: policyId,
    title: policyTitle,
    policy_number: detectedCode,
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

  return { versionId, fileId };
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

export async function archivePolicy(policyId: string, reason?: string) {
  const supabase = assertSupabase();
  const { error } = await supabase.rpc("archive_policy", {
    p_policy_id: policyId,
    p_reason: reason?.trim() || null,
  });

  if (error) {
    throw error;
  }
}

export async function setPolicyReference(policyId: string, reference: string) {
  const supabase = assertSupabase();
  const { error } = await supabase.rpc("set_policy_reference", {
    p_policy_id: policyId,
    p_reference: reference,
  });

  if (error) {
    throw error;
  }
}

// Download the raw bytes of a stored file (no audit tracking) for background
// tasks such as backfilling a missing policy code.
export async function downloadPolicyFileBytes(
  file: Pick<PolicyFile, "bucket_id" | "storage_path">,
): Promise<ArrayBuffer> {
  const supabase = assertSupabase();
  const { data, error } = await supabase.storage
    .from(file.bucket_id)
    .download(file.storage_path);

  if (error || !data) {
    throw error ?? new Error("تعذر تنزيل الملف.");
  }

  return data.arrayBuffer();
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

const workflowErrorPatterns: { test: RegExp; message: string }[] = [
  {
    test: /schema cache|could not find the function|does not exist|42883|pgrst202/i,
    message:
      "هذه الميزة غير مفعّلة على الخادم بعد. يرجى التواصل مع الدعم الفني لتفعيلها.",
  },
  {
    test: /not allowed|permission denied|row-level security|42501/i,
    message: "لا تملك صلاحية تنفيذ هذا الإجراء.",
  },
  {
    test: /already archived/i,
    message: "تم حذف هذه السياسة مسبقًا.",
  },
  {
    test: /policy not found/i,
    message: "لم يتم العثور على السياسة.",
  },
  {
    test: /active authenticated profile|not authenticated|jwt/i,
    message: "انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.",
  },
  {
    test: /policy version is required/i,
    message: "لا يمكن حذف السياسة لعدم وجود نسخة مرتبطة بها.",
  },
];

// Turn raw database/network errors into clear Arabic messages, and never leak
// internal technical details (function names, schema cache, SQL codes) to users.
export function readableWorkflowError(error: unknown) {
  const raw = errorMessage(error);

  for (const pattern of workflowErrorPatterns) {
    if (pattern.test.test(raw)) {
      return pattern.message;
    }
  }

  // Our own validation messages are written in Arabic; anything else is a raw
  // technical error, so fall back to a friendly generic message.
  if (/[؀-ۿ]/.test(raw)) {
    return raw;
  }

  return "تعذّر إكمال العملية. يرجى المحاولة مرة أخرى، وإذا استمرت المشكلة تواصل مع الدعم الفني.";
}
