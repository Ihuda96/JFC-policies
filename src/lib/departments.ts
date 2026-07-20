import type { PolicyBundle } from "./types";

// Prefixes that appear in policy codes but are NOT departments (cluster name,
// document-type/series markers). They are skipped while reading a code.
const NON_DEPARTMENT_TOKENS = new Set([
  "JFHC",
  "JFC",
  "JHC",
  "MOH",
  "PP",
  "POL",
  "SOP",
  "PR",
  "APP",
  "FRM",
  "GL",
]);

// High-confidence department code → Arabic name. Extend this map with the
// official JFC department code list to get precise names for every code.
const DEPARTMENT_NAMES: Record<string, string> = {
  HRD: "إدارة الموارد البشرية",
  HRO: "إدارة الموارد البشرية",
  HR: "إدارة الموارد البشرية",
  IPC: "إدارة مكافحة العدوى",
  QM: "إدارة الجودة",
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

export const UNCLASSIFIED_LABEL = "غير مصنف";

function cleanText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

// Read the first alphabetic department code from any coded value, e.g.
// "JFHC-HRD-HRO-APP-PP-032" → "HRD", "الهيكل التنظيمي HPD 01" → "HPD".
function departmentCodeFrom(...sources: (string | null | undefined)[]) {
  for (const source of sources) {
    if (!source) {
      continue;
    }

    const tokens = source.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    for (const token of tokens) {
      if (NON_DEPARTMENT_TOKENS.has(token)) {
        continue;
      }
      if (/^[A-Z]{2,6}$/.test(token)) {
        return token;
      }
    }
  }

  return null;
}

export interface PolicyDepartment {
  key: string;
  label: string;
  code: string | null;
}

export function resolvePolicyDepartment(policy: PolicyBundle): PolicyDepartment {
  // 1) Department text set explicitly by the organization takes priority.
  const explicit =
    cleanText(policy.policy_metadata?.issuing_department) ??
    cleanText(policy.owner_department);
  if (explicit) {
    return { key: explicit, label: explicit, code: null };
  }

  // 2) Otherwise detect the department code embedded in the policy number/title.
  const code = departmentCodeFrom(
    policy.policy_number,
    policy.policy_metadata?.extracted_policy_number,
    policy.title,
    policy.policy_metadata?.extracted_title,
  );

  if (code) {
    const named = DEPARTMENT_NAMES[code];
    return { key: named ?? code, label: named ?? `قسم ${code}`, code };
  }

  // 3) Nothing detected.
  return { key: UNCLASSIFIED_LABEL, label: UNCLASSIFIED_LABEL, code: null };
}

export interface DepartmentGroup {
  key: string;
  label: string;
  policies: PolicyBundle[];
}

// Group policies by resolved department, sorted alphabetically with the
// "unclassified" bucket always last.
export function groupPoliciesByDepartment(policies: PolicyBundle[]): DepartmentGroup[] {
  const groups = new Map<string, DepartmentGroup>();

  for (const policy of policies) {
    const department = resolvePolicyDepartment(policy);
    const existing = groups.get(department.key);
    if (existing) {
      existing.policies.push(policy);
    } else {
      groups.set(department.key, {
        key: department.key,
        label: department.label,
        policies: [policy],
      });
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (a.key === UNCLASSIFIED_LABEL) {
      return 1;
    }
    if (b.key === UNCLASSIFIED_LABEL) {
      return -1;
    }
    return a.label.localeCompare(b.label, "ar");
  });
}
