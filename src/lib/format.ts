import type { AppRole, PolicyStatus, ProfileStatus, VersionStatus } from "./types";

export const roleLabels: Record<AppRole, string> = {
  quality_staff: "موظف جودة",
  quality_manager: "مدير جودة",
  system_admin: "مدير نظام",
};

export const profileStatusLabels: Record<ProfileStatus, string> = {
  pending: "بانتظار التفعيل",
  active: "نشط",
  disabled: "معطل",
};

export const policyStatusLabels: Record<PolicyStatus, string> = {
  draft: "قيد الإعداد",
  pending_approval: "بانتظار الاعتماد",
  returned_for_revision: "معادة للتعديل",
  resubmitted: "أعيد إرسالها",
  approved: "معتمدة",
  archived: "مؤرشفة",
};

export const versionStatusLabels: Record<VersionStatus, string> = {
  draft: "مسودة",
  submitted: "مرسلة",
  returned: "معادة",
  approved: "معتمدة",
  superseded: "مستبدلة",
  archived: "مؤرشفة",
};

export function formatDate(value?: string | null) {
  if (!value) {
    return "غير محدد";
  }

  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: value.includes("T") ? "short" : undefined,
  }).format(new Date(value));
}

export function fileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} بايت`;
  }

  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} ك.ب`;
  }

  return `${(kb / 1024).toFixed(1)} م.ب`;
}

export function initials(name?: string | null) {
  if (!name) {
    return "ج";
  }

  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}
