import { classifyPolicy } from "./departments";
import type { PolicyBundle } from "./types";

export type DeptHealth = "good" | "attention" | "risk";

export interface DeptStat {
  key: string;
  label: string;
  code: string | null;
  total: number;
  approved: number;
  inProgress: number;
  dueSoon: number;
  overdue: number;
  health: DeptHealth;
}

export interface ComplianceTotals {
  total: number;
  approved: number;
  inProgress: number;
  dueSoon: number;
  overdue: number;
  departments: number;
}

export interface ComplianceReport {
  departments: DeptStat[];
  totals: ComplianceTotals;
  brief: string[];
}

const IN_PROGRESS = new Set([
  "draft",
  "pending_approval",
  "returned_for_revision",
  "resubmitted",
]);

const REVIEW_WINDOW_DAYS = 90;
const HEALTH_RANK: Record<DeptHealth, number> = { risk: 0, attention: 1, good: 2 };

function reviewState(policy: PolicyBundle, now: number, soon: number) {
  if (policy.status !== "approved" || !policy.next_review_at) {
    return { overdue: false, dueSoon: false };
  }
  const time = new Date(policy.next_review_at).getTime();
  if (Number.isNaN(time)) {
    return { overdue: false, dueSoon: false };
  }
  return { overdue: time < now, dueSoon: time >= now && time <= soon };
}

export function buildComplianceReport(policies: PolicyBundle[]): ComplianceReport {
  const now = Date.now();
  const soon = now + REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const map = new Map<string, DeptStat>();
  const totals: ComplianceTotals = {
    total: 0,
    approved: 0,
    inProgress: 0,
    dueSoon: 0,
    overdue: 0,
    departments: 0,
  };

  for (const policy of policies) {
    const { departmentKey, departmentLabel, departmentCode } = classifyPolicy(policy);
    let stat = map.get(departmentKey);
    if (!stat) {
      stat = {
        key: departmentKey,
        label: departmentLabel,
        code: departmentCode,
        total: 0,
        approved: 0,
        inProgress: 0,
        dueSoon: 0,
        overdue: 0,
        health: "good",
      };
      map.set(departmentKey, stat);
    }

    stat.total += 1;
    totals.total += 1;

    if (policy.status === "approved") {
      stat.approved += 1;
      totals.approved += 1;
    } else if (IN_PROGRESS.has(policy.status)) {
      stat.inProgress += 1;
      totals.inProgress += 1;
    }

    const { overdue, dueSoon } = reviewState(policy, now, soon);
    if (overdue) {
      stat.overdue += 1;
      totals.overdue += 1;
    } else if (dueSoon) {
      stat.dueSoon += 1;
      totals.dueSoon += 1;
    }
  }

  const departments = [...map.values()].map((stat) => {
    const health: DeptHealth =
      stat.overdue > 0 ? "risk" : stat.inProgress > 0 || stat.dueSoon > 0 ? "attention" : "good";
    return { ...stat, health };
  });

  departments.sort((a, b) => {
    if (HEALTH_RANK[a.health] !== HEALTH_RANK[b.health]) {
      return HEALTH_RANK[a.health] - HEALTH_RANK[b.health];
    }
    return b.total - a.total;
  });

  totals.departments = departments.length;

  return { departments, totals, brief: buildBrief(departments, totals) };
}

function buildBrief(departments: DeptStat[], totals: ComplianceTotals): string[] {
  if (totals.total === 0) {
    return ["لا توجد سياسات نشطة لعرض ملخّص عنها بعد."];
  }

  const lines: string[] = [];
  lines.push(
    `تضم المنصة ${totals.total} سياسة نشطة موزّعة على ${totals.departments} إدارة، ` +
      `منها ${totals.approved} معتمدة و${totals.inProgress} قيد الإعداد أو المراجعة.`,
  );

  lines.push(
    totals.overdue > 0
      ? `⚠ ${totals.overdue} سياسة تجاوزت موعد مراجعتها وتحتاج تحديثًا عاجلًا.`
      : "لا توجد سياسات متأخرة عن موعد المراجعة.",
  );

  if (totals.dueSoon > 0) {
    lines.push(`${totals.dueSoon} سياسة تقترب من موعد مراجعتها خلال ٩٠ يومًا.`);
  }

  const busiest = [...departments].sort((a, b) => b.total - a.total)[0];
  if (busiest) {
    lines.push(`أكثر الإدارات نشاطًا: ${busiest.label} بـ ${busiest.total} سياسة.`);
  }

  const needsAttention = departments.filter((dept) => dept.health === "risk");
  if (needsAttention.length > 0) {
    lines.push(
      `إدارات تحتاج متابعة عاجلة: ${needsAttention.map((dept) => dept.label).join("، ")}.`,
    );
  }

  return lines;
}
