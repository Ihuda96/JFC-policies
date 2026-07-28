import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  Building2,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  FileText,
  ListChecks,
  LogOut,
  Search,
  Undo2,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { classifyPolicy, policyReference } from "../../lib/departments";
import { formatDate } from "../../lib/format";
import { isExecutive } from "../../lib/permissions";
import { readableWorkflowError, signedFileUrl } from "../../lib/policyWorkflow";
import { errorMessage, supabase } from "../../lib/supabase";
import { useConfirm } from "../../components/ConfirmDialog";
import { LoadingState } from "../../components/LoadingState";
import { useToast } from "../../components/Toast";
import { ExecutiveSetPassword } from "./ExecutiveSetPassword";
import type { PolicyBundle, PolicyFile } from "../../lib/types";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "صباح الخير";
  if (hour < 17) return "طاب يومك";
  return "مساء الخير";
}

const dateLabel = new Intl.DateTimeFormat("ar", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
}).format(new Date());

const monthFmt = new Intl.DateTimeFormat("ar", { month: "short" });

function pct(count: number, max: number) {
  return max > 0 ? Math.round((count / max) * 100) : 0;
}

export function ExecutivePage() {
  const { profile, loading: authLoading, signOut } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [policies, setPolicies] = useState<PolicyBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [sealing, setSealing] = useState(false);

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

  const pending = useMemo(
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

  const visiblePending = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return pending;
    return pending.filter((policy) =>
      [policy.title, policy.policy_number, policy.owner_department]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [pending, query]);

  const recentFinal = useMemo(() => finalised.slice(0, 10), [finalised]);

  /** Top departments by approved-policy volume (browsing overview). */
  const departmentBars = useMemo(() => {
    const counts = new Map<string, number>();
    for (const policy of policies) {
      const label = classifyPolicy(policy).departmentLabel;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const rows = [...counts.entries()]
      .map(([label, count]) => ({ key: label, label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    const max = Math.max(1, ...rows.map((row) => row.count));
    return rows.map((row) => ({ ...row, pct: pct(row.count, max) }));
  }, [policies]);

  /** Final approvals per month, oldest to newest — matches the dashboard's
   *  trend pattern so the two pages share one visual language. */
  const trend = useMemo(() => {
    const months: { label: string; count: number }[] = [];
    const index = new Map<string, number>();
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date();
      d.setMonth(d.getMonth() - i, 1);
      index.set(`${d.getFullYear()}-${d.getMonth()}`, months.length);
      months.push({ label: monthFmt.format(d), count: 0 });
    }
    for (const policy of finalised) {
      if (!policy.final_approved_at) continue;
      const d = new Date(policy.final_approved_at);
      if (Number.isNaN(d.getTime())) continue;
      const idx = index.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (idx !== undefined) months[idx].count += 1;
    }
    const max = Math.max(1, ...months.map((m) => m.count));
    return months.map((m) => ({ ...m, pct: pct(m.count, max) }));
  }, [finalised]);

  async function approveAll() {
    if (!supabase || pending.length === 0) return;

    const confirmed = await confirm({
      title: "الاعتماد النهائي",
      body: `سيتم اعتماد ${pending.length} سياسة دفعة واحدة ونشرها بشكل نهائي. لا يمكن التراجع عن هذا الإجراء.`,
      confirmLabel: "اعتماد الكل",
    });
    if (!confirmed) return;

    setApprovingAll(true);
    try {
      const { error } = await supabase.rpc("ceo_final_approve_all");
      if (error) throw error;
      setSealing(true);
      window.setTimeout(() => setSealing(false), 1500);
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setApprovingAll(false);
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
      <main className="exec-portal-loading">
        <span className="spinner" aria-label="جاري التحميل" />
      </main>
    );
  }

  if (!profile) return <Navigate to="/executive/login" replace />;
  if (!isExecutive(profile)) return <Navigate to="/app" replace />;
  if (profile.must_change_password) return <ExecutiveSetPassword />;

  const firstName = (profile.full_name ?? "").split(" ")[0];

  return (
    <div className="exec-portal">
      {sealing ? (
        <div className="exec-seal-stage" role="status" aria-live="polite">
          <div className="exec-seal-mark">
            <Check aria-hidden="true" />
          </div>
          <p>تم الاعتماد النهائي</p>
        </div>
      ) : null}

      <header className="topbar">
        <div className="topbar-title">
          <span>تجمع جدة الصحي الأول</span>
          <strong>المكتب التنفيذي</strong>
        </div>
        <button type="button" className="secondary-button" onClick={() => void signOut()}>
          <LogOut aria-hidden="true" />
          خروج
        </button>
      </header>

      <main className="content-area">
        <div className="page-stack">
          <section className="dash-hero">
            <div className="dash-hero-text">
              <p className="eyebrow">
                {greeting()}
                {firstName ? `، ${firstName}` : ""}
              </p>
              <h1>{pending.length} سياسة بانتظار اعتمادك</h1>
              <p>{dateLabel}</p>
            </div>
            {pending.length > 0 ? (
              <button
                type="button"
                className="dash-hero-cta"
                disabled={approvingAll}
                onClick={() => void approveAll()}
              >
                <CheckCheck aria-hidden="true" />
                <span>
                  {approvingAll ? "جاري الاعتماد..." : `اعتماد الكل (${pending.length})`}
                </span>
              </button>
            ) : null}
          </section>

          <section className="exec-kpis">
            <article className="kpi-card">
              <span className="kpi-icon">
                <Clock aria-hidden="true" />
              </span>
              <strong className="kpi-value">{pending.length}</strong>
              <span className="kpi-label">بانتظار اعتمادك</span>
              <em className="kpi-sub">اجتازت مراجعة الجودة</em>
            </article>
            <article className="kpi-card">
              <span className="kpi-icon">
                <CheckCircle2 aria-hidden="true" />
              </span>
              <strong className="kpi-value">{finalised.length}</strong>
              <span className="kpi-label">معتمدة نهائيًا</span>
              <em className="kpi-sub">في المكتبة النهائية</em>
            </article>
            <article className="kpi-card">
              <span className="kpi-icon">
                <ListChecks aria-hidden="true" />
              </span>
              <strong className="kpi-value">{completion}٪</strong>
              <span className="kpi-label">نسبة الإنجاز</span>
              <em className="kpi-sub">
                {finalised.length} من {policies.length} سياسة
              </em>
            </article>
            <article className="kpi-card">
              <span className="kpi-icon">
                <Building2 aria-hidden="true" />
              </span>
              <strong className="kpi-value">{departmentBars.length}</strong>
              <span className="kpi-label">إدارات نشطة</span>
              <em className="kpi-sub">لديها سياسات معتمدة</em>
            </article>
          </section>

          <section className="exec-charts">
            <article className="chart-card">
              <h2>أكثر الإدارات إصدارًا للسياسات</h2>
              {departmentBars.length === 0 ? (
                <p className="chart-empty">لا توجد بيانات.</p>
              ) : (
                <div className="bar-list">
                  {departmentBars.map((bar) => (
                    <div className="bar-row" key={bar.key} title={`${bar.label}: ${bar.count}`}>
                      <span className="bar-label">{bar.label}</span>
                      <span className="bar-track">
                        <span className="bar-fill" style={{ inlineSize: `${Math.max(bar.pct, 3)}%` }} />
                      </span>
                      <span className="bar-value">{bar.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="chart-card">
              <h2>الاعتمادات النهائية · آخر ٦ أشهر</h2>
              <div className="mini-bars" role="img" aria-label="الاعتمادات النهائية خلال الأشهر الستة الأخيرة">
                {trend.map((point, index) => (
                  <div className="mini-bar-col" key={index} title={`${point.label}: ${point.count}`}>
                    <span className="mini-bar-value">{point.count}</span>
                    <span className="mini-bar-track">
                      <span
                        className="mini-bar-fill"
                        style={{ blockSize: `${point.count > 0 ? Math.max(point.pct, 6) : 2}%` }}
                      />
                    </span>
                    <em className="mini-bar-label">{point.label}</em>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="data-section">
            <div className="section-title-row">
              <h2>بانتظار اعتمادك</h2>
              {pending.length > 3 ? (
                <label className="search-box exec-inline-search">
                  <Search aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="ابحث عن سياسة"
                  />
                </label>
              ) : null}
            </div>

            {loading ? (
              <LoadingState label="جاري تحميل السياسات..." inline />
            ) : visiblePending.length === 0 ? (
              <p className="chart-empty">
                {pending.length === 0 ? "لا شيء ينتظر اعتمادك حاليًا." : "لا توجد نتائج مطابقة."}
              </p>
            ) : (
              <div className="cards-list">
                {visiblePending.map((policy) => {
                  const classification = classifyPolicy(policy);
                  const isOpen = openId === policy.id;
                  return (
                    <article className="policy-card exec-review-card" key={policy.id}>
                      <div>
                        <span className="exec-review-dept">{classification.departmentLabel}</span>
                        <h2>{policy.title}</h2>
                        <p>{policyReference(policy) ?? "بدون رقم"}</p>
                      </div>
                      <dl>
                        <div>
                          <dt>اعتماد الجودة</dt>
                          <dd>{formatDate(policy.approved_at)}</dd>
                        </div>
                        <div>
                          <dt>المراجعة القادمة</dt>
                          <dd>{formatDate(policy.next_review_at)}</dd>
                        </div>
                      </dl>
                      <div className="card-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => void openDocument(policy)}
                        >
                          <FileText aria-hidden="true" />
                          عرض الوثيقة
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            setOpenId(isOpen ? null : policy.id);
                            setNote("");
                          }}
                        >
                          <Undo2 aria-hidden="true" />
                          {isOpen ? "إلغاء" : "إعادة مع ملاحظات"}
                        </button>
                      </div>
                      {isOpen ? (
                        <div className="exec-return-inline">
                          <textarea
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            placeholder="سبب الإعادة"
                            rows={3}
                          />
                          <button
                            type="button"
                            className="danger-button"
                            disabled={busy === policy.id}
                            onClick={() => void returnWithNote(policy)}
                          >
                            تأكيد الإعادة
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="data-section">
            <div className="section-title-row">
              <h2>آخر المعتمدة نهائيًا</h2>
            </div>
            {recentFinal.length === 0 ? (
              <div className="activity-empty">لا توجد سياسات معتمدة نهائيًا بعد.</div>
            ) : (
              <ul className="activity-list">
                {recentFinal.map((policy) => (
                  <li key={policy.id}>
                    <button
                      type="button"
                      className="activity-row exec-activity-row"
                      onClick={() => void openDocument(policy)}
                    >
                      <div className="activity-main">
                        <strong>{policy.title}</strong>
                        <span className="activity-meta">
                          {policyReference(policy) ?? "بدون رقم"} ·{" "}
                          {formatDate(policy.final_approved_at)}
                        </span>
                      </div>
                      <span className="final-seal">
                        <Check aria-hidden="true" />
                        معتمدة نهائيًا
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
