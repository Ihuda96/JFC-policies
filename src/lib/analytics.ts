import { classifyPolicy } from "./departments";
import { policyStatusLabels } from "./format";
import type { AppRole, PolicyBundle, PolicyStatus } from "./types";

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

/* ── Executive dashboard summary ────────────────────────── */
export interface Bar {
  key: string;
  label: string;
  code?: string | null;
  count: number;
  pct: number;
}

export interface TrendPoint {
  label: string;
  count: number;
  pct: number;
}

export interface DashAction {
  key: string;
  title: string;
  count: number;
  to: string;
}

export interface ExecutiveSummary {
  total: number;
  approved: number;
  pending: number;
  returned: number;
  drafts: number;
  overdue: number;
  dueSoon: number;
  departmentsCovered: number;
  avgTurnaroundDays: number | null;
  statusBars: Bar[];
  departmentBars: Bar[];
  trend: TrendPoint[];
  actions: DashAction[];
  recent: PolicyBundle[];
}

const PENDING_STATUSES: PolicyStatus[] = ["pending_approval", "resubmitted"];

function pct(count: number, max: number) {
  return max > 0 ? Math.round((count / max) * 100) : 0;
}

export function buildExecutiveSummary(
  policies: PolicyBundle[],
  profileId: string | undefined,
  role: AppRole | undefined,
): ExecutiveSummary {
  const now = Date.now();
  const soon = now + 90 * 24 * 60 * 60 * 1000;

  const approvedList = policies.filter((p) => p.status === "approved");
  const pending = policies.filter((p) => PENDING_STATUSES.includes(p.status)).length;
  const returned = policies.filter((p) => p.status === "returned_for_revision").length;
  const drafts = policies.filter((p) => p.status === "draft").length;

  let overdue = 0;
  let dueSoon = 0;
  for (const policy of approvedList) {
    if (!policy.next_review_at) continue;
    const time = new Date(policy.next_review_at).getTime();
    if (Number.isNaN(time)) continue;
    if (time < now) overdue += 1;
    else if (time <= soon) dueSoon += 1;
  }

  // Status distribution
  const statusOrder: PolicyStatus[] = [
    "approved",
    "pending_approval",
    "resubmitted",
    "returned_for_revision",
    "draft",
  ];
  const statusCounts = new Map<PolicyStatus, number>();
  for (const policy of policies) {
    statusCounts.set(policy.status, (statusCounts.get(policy.status) ?? 0) + 1);
  }
  const statusRaw = statusOrder
    .map((status) => ({ status, count: statusCounts.get(status) ?? 0 }))
    .filter((row) => row.count > 0);
  const statusMax = Math.max(1, ...statusRaw.map((row) => row.count));
  const statusBars: Bar[] = statusRaw.map((row) => ({
    key: row.status,
    label: policyStatusLabels[row.status],
    count: row.count,
    pct: pct(row.count, statusMax),
  }));

  // Departments
  const deptCounts = new Map<string, { label: string; code: string | null; count: number }>();
  for (const policy of policies) {
    const { departmentKey, departmentLabel, departmentCode } = classifyPolicy(policy);
    const entry = deptCounts.get(departmentKey);
    if (entry) entry.count += 1;
    else deptCounts.set(departmentKey, { label: departmentLabel, code: departmentCode, count: 1 });
  }
  const deptSorted = [...deptCounts.entries()].sort((a, b) => b[1].count - a[1].count);
  const deptMax = Math.max(1, ...deptSorted.map(([, v]) => v.count));
  const departmentBars: Bar[] = deptSorted.slice(0, 6).map(([key, v]) => ({
    key,
    label: v.label,
    code: v.code,
    count: v.count,
    pct: pct(v.count, deptMax),
  }));

  // Approvals trend — last 6 months
  const months: { key: string; label: string; count: number }[] = [];
  const monthFmt = new Intl.DateTimeFormat("ar", { month: "short" });
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: monthFmt.format(d), count: 0 });
  }
  const monthIndex = new Map(months.map((m, i) => [m.key, i]));
  for (const policy of approvedList) {
    if (!policy.approved_at) continue;
    const d = new Date(policy.approved_at);
    if (Number.isNaN(d.getTime())) continue;
    const idx = monthIndex.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (idx !== undefined) months[idx].count += 1;
  }
  const trendMax = Math.max(1, ...months.map((m) => m.count));
  const trend: TrendPoint[] = months.map((m) => ({
    label: m.label,
    count: m.count,
    pct: pct(m.count, trendMax),
  }));

  // Average approval turnaround (submitted → approved), in days
  const turnarounds: number[] = [];
  for (const policy of approvedList) {
    if (!policy.submitted_at || !policy.approved_at) continue;
    const start = new Date(policy.submitted_at).getTime();
    const end = new Date(policy.approved_at).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
    turnarounds.push((end - start) / (24 * 60 * 60 * 1000));
  }
  const avgTurnaroundDays =
    turnarounds.length > 0
      ? Math.round((turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length) * 10) / 10
      : null;

  // Role-aware action items
  const actions: DashAction[] = [];
  if (role === "quality_manager" && pending > 0) {
    actions.push({ key: "approvals", title: "بانتظار اعتمادك", count: pending, to: "/app/approvals" });
  }
  const mineReturned = policies.filter(
    (p) => p.owner_id === profileId && p.status === "returned_for_revision",
  ).length;
  if (mineReturned > 0) {
    actions.push({ key: "returned", title: "أُعيدت إليك للتعديل", count: mineReturned, to: "/app/workspace" });
  }
  const mineDrafts = policies.filter((p) => p.owner_id === profileId && p.status === "draft").length;
  if (mineDrafts > 0) {
    actions.push({ key: "drafts", title: "مسودات لم تُرسل", count: mineDrafts, to: "/app/workspace" });
  }
  if (overdue > 0) {
    actions.push({ key: "overdue", title: "سياسات تجاوزت المراجعة", count: overdue, to: "/app/reports" });
  }

  const recent = [...policies]
    .sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )
    .slice(0, 8);

  return {
    total: policies.length,
    approved: approvedList.length,
    pending,
    returned,
    drafts,
    overdue,
    dueSoon,
    departmentsCovered: deptCounts.size,
    avgTurnaroundDays,
    statusBars,
    departmentBars,
    trend,
    actions,
    recent,
  };
}
