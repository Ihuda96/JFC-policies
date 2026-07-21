import type { PolicyBundle } from "./types";

// Cluster-level prefixes that are never a department.
const CLUSTER_PREFIXES = new Set(["JFHC", "JFC", "JHC", "MOH"]);

// Document-type / category markers inside a code that are not organizational
// units (e.g. JFHC-HRD-HPD-APP-PP-01 → APP, PP are document markers).
const DOCUMENT_TOKENS = new Set([
  "APP",
  "PP",
  "POL",
  "SOP",
  "PR",
  "FRM",
  "GL",
  "PLAN",
  "PROT",
  "GUIDE",
  "WI",
]);

// Department code → full Arabic name. Extend with the official JFC list to
// cover every department precisely.
const DEPARTMENT_NAMES: Record<string, string> = {
  HRD: "إدارة الموارد البشرية",
  BSS: "دعم حلول الأعمال",
  IPC: "إدارة مكافحة العدوى",
  QM: "إدارة الجودة وسلامة المرضى",
  QPS: "إدارة الجودة وسلامة المرضى",
  PSQ: "إدارة الجودة وسلامة المرضى",
  IT: "إدارة تقنية المعلومات",
  ICT: "إدارة تقنية المعلومات",
  HIT: "إدارة تقنية المعلومات الصحية",
  FIN: "الإدارة المالية",
  NUR: "إدارة التمريض",
  PHARM: "إدارة الصيدلة",
  PHR: "إدارة الصيدلة",
  LAB: "إدارة المختبرات",
  RAD: "إدارة الأشعة",
  PHC: "إدارة الرعاية الصحية الأولية",
  SCM: "إدارة سلسلة الإمداد",
};

// Sub-section / unit code → full Arabic name and its parent department code.
// This lets a lone sub-code (e.g. "HPD 01" in a title) still resolve to its
// department (HRD). Extend with the official JFC unit list.
const SUBSECTIONS: Record<string, { name: string; parent: string }> = {
  HPD: { name: "تخطيط وتطوير الموارد البشرية", parent: "HRD" },
  HRO: { name: "عمليات الموارد البشرية", parent: "HRD" },
};

export const UNCLASSIFIED_LABEL = "غير مصنف";

function cleanText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

// Extract the ordered organizational codes from a coded value, dropping the
// cluster prefix, document-type markers and numeric serials.
// "JFHC-HRD-HPD-APP-PP-01" → ["HRD", "HPD"], "الهيكل التنظيمي HPD 01" → ["HPD"].
function orgCodes(source: string | null | undefined): string[] {
  if (!source) {
    return [];
  }

  return source
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .filter(
      (token) =>
        /^[A-Z]{2,6}$/.test(token) &&
        !CLUSTER_PREFIXES.has(token) &&
        !DOCUMENT_TOKENS.has(token),
    );
}

function firstNonEmpty(...lists: string[][]): string[] {
  for (const list of lists) {
    if (list.length > 0) {
      return list;
    }
  }
  return [];
}

export function departmentName(code: string) {
  return DEPARTMENT_NAMES[code] ?? `قسم ${code}`;
}

export function subsectionName(code: string) {
  return SUBSECTIONS[code]?.name ?? `تصنيف ${code}`;
}

// Derive a policy reference like "HPD 07" from free text (usually the title)
// by finding a department/sub code immediately followed by a serial number.
function deriveReferenceFromText(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }

  const pattern = /([A-Z]{2,6})[\s\-_]?(\d{1,4})/g;
  const upper = text.toUpperCase();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(upper)) !== null) {
    const code = match[1];
    if (CLUSTER_PREFIXES.has(code) || DOCUMENT_TOKENS.has(code)) {
      continue;
    }
    return `${code} ${match[2].padStart(2, "0")}`;
  }

  return null;
}

// Best available policy reference: the stored number first, otherwise the
// number extracted from the policy title so the card never shows "no number"
// when the code is clearly present in the title.
export function policyReference(policy: {
  policy_number?: string | null;
  title?: string | null;
  policy_metadata?: {
    extracted_policy_number?: string | null;
    extracted_title?: string | null;
  } | null;
}): string | null {
  const explicit =
    cleanText(policy.policy_number) ??
    cleanText(policy.policy_metadata?.extracted_policy_number);
  if (explicit) {
    return explicit;
  }

  return (
    deriveReferenceFromText(policy.policy_metadata?.extracted_title) ??
    deriveReferenceFromText(policy.title)
  );
}

export interface PolicyClassification {
  departmentCode: string | null;
  departmentKey: string;
  departmentLabel: string;
  sectionCode: string | null;
  sectionKey: string | null;
  sectionLabel: string | null;
}

export function classifyPolicy(policy: PolicyBundle): PolicyClassification {
  // Read the ordered codes from the richest coded field available.
  const codes = firstNonEmpty(
    orgCodes(policy.policy_number),
    orgCodes(policy.policy_metadata?.extracted_policy_number),
    orgCodes(policy.title),
    orgCodes(policy.policy_metadata?.extracted_title),
  );

  let departmentCode = codes[0] ?? null;
  let sectionCode = codes[1] ?? null;

  // A single code that is actually a sub-section (e.g. only "HPD" in the
  // title): promote its parent department and keep it as the sub-section.
  if (departmentCode && !sectionCode && SUBSECTIONS[departmentCode]) {
    sectionCode = departmentCode;
    departmentCode = SUBSECTIONS[departmentCode].parent;
  }

  if (departmentCode) {
    return {
      departmentCode,
      departmentKey: departmentCode,
      departmentLabel: departmentName(departmentCode),
      sectionCode,
      sectionKey: sectionCode,
      sectionLabel: sectionCode ? subsectionName(sectionCode) : null,
    };
  }

  // No code detected — fall back to the department text set by the org.
  const explicit =
    cleanText(policy.policy_metadata?.issuing_department) ??
    cleanText(policy.owner_department);
  if (explicit) {
    return {
      departmentCode: null,
      departmentKey: explicit,
      departmentLabel: explicit,
      sectionCode: null,
      sectionKey: null,
      sectionLabel: null,
    };
  }

  return {
    departmentCode: null,
    departmentKey: UNCLASSIFIED_LABEL,
    departmentLabel: UNCLASSIFIED_LABEL,
    sectionCode: null,
    sectionKey: null,
    sectionLabel: null,
  };
}

export interface SectionGroup {
  key: string;
  label: string | null;
  code: string | null;
  policies: PolicyBundle[];
}

export interface DepartmentGroup {
  key: string;
  label: string;
  code: string | null;
  count: number;
  sections: SectionGroup[];
}

const NO_SECTION_KEY = "__general__";

// Build a two-level department → sub-section tree from a list of policies.
export function groupPoliciesByDepartment(policies: PolicyBundle[]): DepartmentGroup[] {
  const departments = new Map<
    string,
    {
      key: string;
      label: string;
      code: string | null;
      count: number;
      sections: Map<string, SectionGroup>;
    }
  >();

  for (const policy of policies) {
    const classification = classifyPolicy(policy);
    let department = departments.get(classification.departmentKey);
    if (!department) {
      department = {
        key: classification.departmentKey,
        label: classification.departmentLabel,
        code: classification.departmentCode,
        count: 0,
        sections: new Map(),
      };
      departments.set(classification.departmentKey, department);
    }

    department.count += 1;

    const sectionKey = classification.sectionKey ?? NO_SECTION_KEY;
    let section = department.sections.get(sectionKey);
    if (!section) {
      section = {
        key: sectionKey,
        label: classification.sectionLabel,
        code: classification.sectionCode,
        policies: [],
      };
      department.sections.set(sectionKey, section);
    }
    section.policies.push(policy);
  }

  const sortByLabel = (a: { label: string | null; key: string }, b: { label: string | null; key: string }) => {
    if (a.key === NO_SECTION_KEY) {
      return 1;
    }
    if (b.key === NO_SECTION_KEY) {
      return -1;
    }
    return (a.label ?? "").localeCompare(b.label ?? "", "ar");
  };

  return [...departments.values()]
    .map((department) => ({
      key: department.key,
      label: department.label,
      code: department.code,
      count: department.count,
      sections: [...department.sections.values()].sort(sortByLabel),
    }))
    .sort((a, b) => {
      if (a.key === UNCLASSIFIED_LABEL) {
        return 1;
      }
      if (b.key === UNCLASSIFIED_LABEL) {
        return -1;
      }
      return a.label.localeCompare(b.label, "ar");
    });
}
