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

// Official JFC department & unit codes → full Arabic name.
// Source: JFC "Department Codes" reference sheet.
const CODE_NAMES: Record<string, string> = {
  INA: "المراجعة الداخلية",
  LEA: "الشئون القانونية",
  STP: "الإستراتيجية والتحول ومكتب إدارة المشاريع",
  STA: "إدارة الاستراتيجية والتحول",
  PMO: "مكتب إدارة المشاريع",
  CCM: "التواصل وإدارة التغيير",
  COM: "إدارة التواصل",
  CHM: "إدارة التغيير",
  MAR: "إدارة التسويق",
  GRC: "الحوكمة والإلتزام والمخاطر",
  GOV: "إدارة الحوكمة",
  ERM: "إدارة المخاطر المؤسسية",
  CPC: "إدارة الالتزام",
  MEC: "المدينة الطبية",
  HES: "الخدمات الصحية",
  ALH: "الخدمات الصحية المساندة",
  NUR: "التمريض",
  PHM: "الصحة السكانية",
  MOC: "نموذج الرعاية الصحية",
  SEL: "مسار الخدمات الإكلينيكية",
  PCH: "الصحة العامة والمجتمعية",
  CPM: "الأداء الإكلينيكي",
  HDO: "تقديم الرعاية الصحية",
  SPC: "المراكز المتخصصة",
  URH: "المستشفيات العامة",
  URP: "مراكز الرعاية الأولية الحضرية",
  LEH: "المستشفيات المرجعية",
  RUH: "المستشفيات الطرفية",
  RUP: "مراكز الرعاية الأولية الريفية",
  CSL: "مسار تخصص الرعاية القلبية",
  ESL: "مسار تخصص الرعاية الطارئة",
  GSL: "مسار تخصص النساء والولادة",
  QAP: "الجودة والأداء",
  PSR: "الجودة وسلامة المرضى",
  QAA: "الجودة والإعتماد",
  PAO: "الأداء والمخرجات",
  PED: "تجربة المستفيد",
  OPE: "التشغيل",
  FAP: "المنشآت",
  CPD: "العقود والمشتريات",
  EAD: "الهندسة والصيانة",
  SUS: "الخدمات المساندة",
  SES: "الأمن والسلامة",
  DTT: "الصحة الرقمية",
  DSA: "الإستراتيجية الرقمية والبنية المؤسسية",
  DMA: "مكتب البيانات",
  CLS: "الأنظمة الإكلينيكية",
  BUS: "حلول الأعمال",
  BSS: "دعم حلول الأعمال",
  INO: "البنية التحتية والتشغيل",
  FIN: "المالية",
  BFP: "التخطيط المالي والميزانية",
  FIO: "عمليات الحسابات",
  SEO: "مكتب كفاءة الإنفاق",
  RVM: "إدارة الإيرادات",
  REC: "السجلات",
  FIT: "التحول المالي",
  HRD: "الموارد البشرية",
  PYR: "الرواتب",
  HPD: "تخطيط وتطوير الموارد البشرية",
  HRO: "عمليات الموارد البشرية",
  JTA: "الوظائف والنقل والتكليف",
  HCR: "التوظيف",
  TAA: "الشئون الأكاديمية والتدريب",
  AAD: "الشئون الأكاديمية",
  REP: "الأبحاث",
  MEA: "الأكاديمية الطبية",
};

// Unit code → parent department code. Used to roll a stand-alone unit code
// (e.g. only "HPD 01" in a title) up to its department (HRD).
const UNIT_PARENTS: Record<string, string> = {
  STA: "STP",
  PMO: "STP",
  COM: "CCM",
  CHM: "CCM",
  MAR: "CCM",
  GOV: "GRC",
  ERM: "GRC",
  CPC: "GRC",
  CSL: "SEL",
  ESL: "SEL",
  GSL: "SEL",
  PSR: "QAP",
  QAA: "QAP",
  PAO: "QAP",
  PED: "QAP",
  FAP: "OPE",
  CPD: "OPE",
  EAD: "OPE",
  SUS: "OPE",
  SES: "OPE",
  DSA: "DTT",
  DMA: "DTT",
  CLS: "DTT",
  BUS: "DTT",
  INO: "DTT",
  BFP: "FIN",
  FIO: "FIN",
  SEO: "FIN",
  RVM: "FIN",
  REC: "FIN",
  FIT: "FIN",
  PYR: "HRD",
  HPD: "HRD",
  HRO: "HRD",
  JTA: "HRD",
  HCR: "HRD",
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
  return CODE_NAMES[code] ?? `قسم ${code}`;
}

export function subsectionName(code: string) {
  return CODE_NAMES[code] ?? `تصنيف ${code}`;
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

// Best available policy reference. The stored policy number is the full code
// (e.g. JFHC-HRD-HPD-APP-PP-01) and is shown as-is; otherwise the code is
// derived from the title so the number is never blank when it is present.
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

  // A single code that is actually a unit (e.g. only "HPD" in the title):
  // promote its parent department and keep it as the sub-section.
  if (departmentCode && !sectionCode && UNIT_PARENTS[departmentCode]) {
    sectionCode = departmentCode;
    departmentCode = UNIT_PARENTS[departmentCode];
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

  const sortByLabel = (
    a: { label: string | null; key: string },
    b: { label: string | null; key: string },
  ) => {
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
