import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Check, FileText, LogOut, Search, Undo2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { classifyPolicy, policyReference } from "../../lib/departments";
import { formatDate } from "../../lib/format";
import { isExecutive } from "../../lib/permissions";
import { readableWorkflowError, signedFileUrl } from "../../lib/policyWorkflow";
import { errorMessage, supabase } from "../../lib/supabase";
import { useToast } from "../../components/Toast";
import { ExecutiveSetPassword } from "./ExecutiveSetPassword";
import type { PolicyBundle, PolicyFile } from "../../lib/types";

type Tab = "awaiting" | "final" | "all";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "awaiting", label: "بانتظار اعتمادك" },
  { key: "final", label: "المعتمدة نهائيًا" },
  { key: "all", label: "الأرشيف الكامل" },
];

const dateLabel = new Intl.DateTimeFormat("ar", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
}).format(new Date());

const monthLabel = new Intl.DateTimeFormat("ar", { month: "short" });

/** Sequential gold ramp, light → dark. Lightness verified monotonic. */
const GOLD_RAMP = ["#e3c88a", "#d5b876", "#c9a961", "#b39a55", "#a88b4e", "#8d7442"];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "صباح الخير";
  if (hour < 17) return "طاب يومك";
  return "مساء الخير";
}

export function ExecutivePage() {
  const { profile, loading: authLoading, signOut } = useAuth();
  const toast = useToast();
  const [policies, setPolicies] = useState<PolicyBundle[]>([]);
  const [tab, setTab] = useState<Tab>("awaiting");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sealing, setSealing] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("policies")
      .select(
        "*, policy_files:policy_files!policy_files_policy_id_fkey(*), policy_metadata:policy_metadata!policy_metadata_policy_id_fkey(*)",
      )
      .eq("status", "approved")
      .order("approved_at", { ascending: false });

    if (!error) {
      setPolicies((data as PolicyBundle[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const awaiting = useMemo(
    () => policies.filter((policy) => !policy.final_approved_at),
    [policies],
  );
  const finalised = useMemo(
    () => policies.filter((policy) => policy.final_approved_at),
    [policies],
  );

  const completion = policies.length
    ? Math.round((finalised.length / policies.length) * 100)
    : 0;

  /** Final approvals per month across the last six months. */
  const trend = useMemo(() => {
    const buckets: Array<{ label: string; count: number }> = [];
    const now = new Date();
    for (let back = 5; back >= 0; back -= 1) {
      const point = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const next = new Date(point.getFullYear(), point.getMonth() + 1, 1);
      const count = finalised.filter((policy) => {
        const stamp = policy.final_approved_at
          ? new Date(policy.final_approved_at)
          : null;
        return stamp !== null && stamp >= point && stamp < next;
      }).length;
      buckets.push({ label: monthLabel.format(point), count });
    }
    return buckets;
  }, [finalised]);

  /** Departments with the most approved policies. */
  const departments = useMemo(() => {
    const counts = new Map<string, number>();
    for (const policy of policies) {
      const label = classifyPolicy(policy).departmentLabel;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const rows = [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    const max = rows[0]?.count ?? 1;
    return rows.map((row) => ({ ...row, pct: (row.count / max) * 100 }));
  }, [policies]);

  const visible = useMemo(() => {
    const base = tab === "awaiting" ? awaiting : tab === "final" ? finalised : policies;
    const normalized = query.trim().toLowerCase();
    if (!normalized) return base;
    return base.filter((policy) =>
      [policy.title, policy.policy_number, policy.owner_department]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [tab, awaiting, finalised, policies, query]);

  async function finalApprove(policy: PolicyBundle) {
    if (!supabase) return;
    setBusy(policy.id);
    try {
      const { error } = await supabase.rpc("ceo_final_approve", { p_policy_id: policy.id });
      if (error) throw error;
      setSealing(true);
      window.setTimeout(() => setSealing(false), 1700);
      setOpenId(null);
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function returnWithNote(policy: PolicyBundle) {
    if (!supabase) return;
    if (note.trim().length === 0) {
      toast.error("اكتب ملاحظتك قبل الإعادة.");
      return;
    }
    setBusy(policy.id);
    try {
      const { error } = await supabase.rpc("ceo_return_policy", {
        p_policy_id: policy.id,
        p_comment: note.trim(),
      });
      if (error) throw error;
      toast.success("أُعيدت السياسة مع ملاحظاتك.");
      setNote("");
      setOpenId(null);
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function openDocument(policy: PolicyBundle) {
    const file = (policy.policy_files ?? []).find(
      (item: PolicyFile) => item.file_kind === "original",
    );
    if (!file) {
      toast.error("لا يوجد ملف مرفق.");
      return;
    }
    try {
      const url = await signedFileUrl(file, "preview");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(readableWorkflowError(err));
    }
  }

  if (authLoading) {
    return (
      <main className="exec-portal exec-portal-loading">
        <span className="exec-spinner" aria-label="جاري التحميل" />
      </main>
    );
  }

  if (!profile) return <Navigate to="/executive/login" replace />;
  if (!isExecutive(profile)) return <Navigate to="/app" replace />;
  if (profile.must_change_password) return <ExecutiveSetPassword />;

  const firstName = (profile.full_name ?? "").split(" ")[0];

  // Trend geometry — a single series, so no legend; only the endpoint is marked.
  // The plot runs right-to-left so it matches the Arabic month axis beneath it:
  // the oldest month sits on the right, the newest on the left.
  const chartW = 320;
  const chartH = 108;
  const peak = Math.max(...trend.map((point) => point.count), 1);
  const stepX = trend.length > 1 ? chartW / (trend.length - 1) : chartW;
  const points = trend.map((point, index) => ({
    ...point,
    x: chartW - index * stepX,
    // Fraction of the way in from the oldest (right) end of the axis. In RTL
    // that is inset-inline-START, since inline-end resolves to the left edge.
    fromOldest: (index * stepX) / chartW,
    y: chartH - (point.count / peak) * (chartH - 14) - 4,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath =
    points.length > 0
      ? `${linePath} L${points[points.length - 1].x},${chartH} L${points[0].x},${chartH} Z`
      : "";
  const last = points[points.length - 1];

  return (
    <main className="exec-portal">
      <div className="exec-aurora" aria-hidden="true" />
      <div className="exec-grain" aria-hidden="true" />

      {sealing ? (
        <div className="exec-seal-stage" role="status" aria-live="polite">
          <div className="exec-seal-mark">
            <Check aria-hidden="true" />
          </div>
          <p>تم الاعتماد النهائي</p>
        </div>
      ) : null}

      <header className="exec-header">
        <div className="exec-header-brand">
          <img src="/brand/jfc-logo-stacked-white-alt.jpg" alt="تجمع جدة الصحي الأول" />
          <div>
            <span>تجمع جدة الصحي الأول</span>
            <strong>المكتب التنفيذي</strong>
          </div>
        </div>
        <button type="button" className="exec-ghost-button" onClick={() => void signOut()}>
          <LogOut aria-hidden="true" />
          خروج
        </button>
      </header>

      {/* Briefing — the one number the office leads with, plus the state of play */}
      <section className="exec-briefing">
        <div className="exec-briefing-lead">
          <p className="exec-date">{dateLabel}</p>
          <h1>
            {greeting()}
            {firstName ? `، ${firstName}` : ""}
          </h1>
          <span className="exec-rule" />
          <p className="exec-hero-label">بانتظار اعتمادك النهائي</p>
          <strong className="exec-hero-figure">{awaiting.length}</strong>
          <p className="exec-hero-sub">
            {awaiting.length === 0
              ? "لا شيء ينتظر قرارك"
              : "سياسة اجتازت مراجعة الجودة"}
          </p>
        </div>

        <div className="exec-briefing-side">
          <article className="exec-panel exec-meter-panel">
            <h2>اكتمال الاعتماد النهائي</h2>
            <div className="exec-meter-value">
              <strong>{completion}</strong>
              <span>%</span>
            </div>
            <div
              className="exec-meter"
              role="img"
              aria-label={`${completion} بالمئة من السياسات معتمدة نهائيًا`}
            >
              <span className="exec-meter-fill" style={{ inlineSize: `${completion}%` }} />
            </div>
            <p className="exec-meter-note">
              {finalised.length} من {policies.length} سياسة
            </p>
          </article>

          <div className="exec-tiles">
            <article className="exec-panel exec-tile">
              <span>معتمدة نهائيًا</span>
              <strong>{finalised.length}</strong>
            </article>
            <article className="exec-panel exec-tile">
              <span>إجمالي السياسات</span>
              <strong>{policies.length}</strong>
            </article>
          </div>
        </div>
      </section>

      {/* Governance at a glance */}
      <section className="exec-charts">
        <article className="exec-panel">
          <h2>الاعتمادات النهائية · آخر ٦ أشهر</h2>
          <div className="exec-chart-wrap">
            <svg
              viewBox={`0 0 ${chartW} ${chartH}`}
              className="exec-trend"
              preserveAspectRatio="none"
              role="img"
              aria-label="الاعتمادات النهائية خلال الأشهر الستة الماضية"
            >
              <line
                x1="0"
                y1={chartH - 0.5}
                x2={chartW}
                y2={chartH - 0.5}
                className="exec-axis"
              />
              <path d={areaPath} className="exec-trend-area" />
              <path d={linePath} className="exec-trend-line" />
              {last ? (
                <circle cx={last.x} cy={last.y} r="4.5" className="exec-trend-dot" />
              ) : null}
              {points.map((point, index) => (
                <rect
                  key={index}
                  x={point.x - stepX / 2}
                  y={0}
                  width={stepX}
                  height={chartH}
                  fill="transparent"
                  onMouseEnter={() => setHoverPoint(index)}
                  onMouseLeave={() => setHoverPoint(null)}
                />
              ))}
            </svg>
            {hoverPoint !== null && points[hoverPoint] ? (
              <span
                className="exec-tip"
                style={{
                  insetInlineStart: `${points[hoverPoint].fromOldest * 100}%`,
                  insetBlockStart: `${(points[hoverPoint].y / chartH) * 100}%`,
                  // Keep the tip inside the panel at both ends of the axis.
                  transform:
                    hoverPoint === 0
                      ? "translate(0, -140%)"
                      : hoverPoint === points.length - 1
                        ? "translate(100%, -140%)"
                        : "translate(50%, -140%)",
                }}
              >
                {points[hoverPoint].label} · {points[hoverPoint].count}
              </span>
            ) : null}
          </div>
          <div className="exec-chart-axis">
            {trend.map((point, index) => (
              <span key={index}>{point.label}</span>
            ))}
          </div>
        </article>

        <article className="exec-panel">
          <h2>أكثر الإدارات إصدارًا للسياسات</h2>
          {departments.length === 0 ? (
            <p className="exec-panel-empty">لا توجد بيانات.</p>
          ) : (
            <ul className="exec-bars">
              {departments.map((row, index) => (
                <li key={row.label}>
                  <span className="exec-bar-label">{row.label}</span>
                  <span className="exec-bar-track">
                    <span
                      className="exec-bar-fill"
                      style={{
                        inlineSize: `${Math.max(row.pct, 4)}%`,
                        background: GOLD_RAMP[Math.min(index, GOLD_RAMP.length - 1)],
                      }}
                    />
                  </span>
                  <span className="exec-bar-value">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      {/* Review queue */}
      <section className="exec-queue">
        <div className="exec-queue-head">
          <h2>مراجعة السياسات</h2>
          <label className="exec-search">
            <Search aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث عن سياسة"
            />
          </label>
        </div>

        <nav className="exec-tabs" aria-label="عرض السياسات">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={tab === item.key ? "active" : ""}
              onClick={() => setTab(item.key)}
            >
              {item.label}
              <span>
                {item.key === "awaiting"
                  ? awaiting.length
                  : item.key === "final"
                    ? finalised.length
                    : policies.length}
              </span>
            </button>
          ))}
        </nav>

        {loading ? (
          <div className="exec-portal-loading">
            <span className="exec-spinner" aria-label="جاري التحميل" />
          </div>
        ) : visible.length === 0 ? (
          <p className="exec-empty">لا توجد سياسات في هذا العرض.</p>
        ) : (
          <div className="exec-list">
            {visible.map((policy) => {
              const classification = classifyPolicy(policy);
              const isOpen = openId === policy.id;
              const done = Boolean(policy.final_approved_at);

              return (
                <article className={isOpen ? "exec-card open" : "exec-card"} key={policy.id}>
                  <button
                    type="button"
                    className="exec-card-head"
                    onClick={() => {
                      setOpenId(isOpen ? null : policy.id);
                      setNote("");
                    }}
                  >
                    <div className="exec-card-title">
                      <h3>{policy.title}</h3>
                      <span dir="ltr">{policyReference(policy) ?? "—"}</span>
                    </div>
                    <div className="exec-card-side">
                      <span className="exec-dept">{classification.departmentLabel}</span>
                      {done ? (
                        <span className="exec-seal-pill">
                          <Check aria-hidden="true" />
                          معتمدة نهائيًا
                        </span>
                      ) : (
                        <span className="exec-pending">بانتظار اعتمادك</span>
                      )}
                    </div>
                  </button>

                  {isOpen ? (
                    <div className="exec-card-body">
                      <dl className="exec-meta">
                        <div>
                          <dt>اعتماد الجودة</dt>
                          <dd>{formatDate(policy.approved_at)}</dd>
                        </div>
                        <div>
                          <dt>المراجعة القادمة</dt>
                          <dd>{formatDate(policy.next_review_at)}</dd>
                        </div>
                        <div>
                          <dt>الاعتماد النهائي</dt>
                          <dd>{done ? formatDate(policy.final_approved_at) : "—"}</dd>
                        </div>
                      </dl>

                      <div className="exec-card-actions">
                        <button
                          type="button"
                          className="exec-ghost-button"
                          onClick={() => void openDocument(policy)}
                        >
                          <FileText aria-hidden="true" />
                          عرض الوثيقة
                        </button>

                        {!done ? (
                          <button
                            type="button"
                            className="exec-button"
                            disabled={busy === policy.id}
                            onClick={() => void finalApprove(policy)}
                          >
                            <Check aria-hidden="true" />
                            الاعتماد النهائي
                          </button>
                        ) : null}
                      </div>

                      {!done ? (
                        <div className="exec-return">
                          <textarea
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            placeholder="ملاحظات الإعادة"
                            rows={3}
                          />
                          <button
                            type="button"
                            className="exec-ghost-button"
                            disabled={busy === policy.id}
                            onClick={() => void returnWithNote(policy)}
                          >
                            <Undo2 aria-hidden="true" />
                            إعادة مع ملاحظات
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
