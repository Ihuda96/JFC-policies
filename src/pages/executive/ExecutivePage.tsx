import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { classifyPolicy, policyReference } from "../../lib/departments";
import { formatDate, initials } from "../../lib/format";
import { isExecutive } from "../../lib/permissions";
import { readableWorkflowError, signedFileUrl } from "../../lib/policyWorkflow";
import { errorMessage, supabase } from "../../lib/supabase";
import { useConfirm } from "../../components/ConfirmDialog";
import { useToast } from "../../components/Toast";
import { ExecutiveSetPassword } from "./ExecutiveSetPassword";
import { useReveal } from "./useReveal";
import type { PolicyBundle, PolicyFile } from "../../lib/types";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "صباح الخير";
  if (hour < 17) return "طاب يومك";
  return "مساء الخير";
}

const monthFmt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { month: "short" });
const todayFmt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function pct(count: number, max: number) {
  return max > 0 ? Math.round((count / max) * 100) : 0;
}

type Tone = "danger" | "warning" | "info" | "success";

function reviewUrgency(days: number): { label: string; tone: Tone } {
  if (days < 0) return { label: `متأخرة ${Math.abs(days)} يوم`, tone: "danger" };
  if (days === 0) return { label: "مستحقة اليوم", tone: "danger" };
  if (days <= 30) return { label: `خلال ${days} يوم`, tone: "warning" };
  return { label: `خلال ${days} يوم`, tone: "info" };
}

export function ExecutivePage() {
  const { profile, loading: authLoading, signOut } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [policies, setPolicies] = useState<PolicyBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [sealing, setSealing] = useState(false);

  const recsHeadRef = useReveal<HTMLDivElement>();
  const recsRef = useReveal<HTMLDivElement>();
  const queueHeadRef = useReveal<HTMLDivElement>();
  const queueListRef = useReveal<HTMLDivElement>();
  const reviewsHeadRef = useReveal<HTMLDivElement>();
  const reviewsRef = useReveal<HTMLDivElement>();
  const chartsHeadRef = useReveal<HTMLDivElement>();
  const chartsGridRef = useReveal<HTMLDivElement>();
  const registerHeadRef = useReveal<HTMLDivElement>();
  const registerRef = useReveal<HTMLDivElement>();

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

  const recentFinal = useMemo(() => finalised.slice(0, 8), [finalised]);

  const departmentRows = useMemo(() => {
    const counts = new Map<string, { approved: number; pending: number }>();
    for (const policy of policies) {
      const label = classifyPolicy(policy).departmentLabel;
      const entry = counts.get(label) ?? { approved: 0, pending: 0 };
      if (policy.final_approved_at) entry.approved += 1;
      else entry.pending += 1;
      counts.set(label, entry);
    }
    return [...counts.entries()]
      .map(([label, { approved, pending }]) => ({ label, approved, pending, total: approved + pending }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [policies]);

  const avgApprovalDays = useMemo(() => {
    const durations: number[] = [];
    for (const policy of finalised) {
      if (!policy.submitted_at || !policy.final_approved_at) continue;
      const start = new Date(policy.submitted_at).getTime();
      const end = new Date(policy.final_approved_at).getTime();
      if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
      durations.push((end - start) / (1000 * 60 * 60 * 24));
    }
    if (durations.length === 0) return null;
    return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  }, [finalised]);

  const upcomingReviews = useMemo(() => {
    const now = Date.now();
    return policies
      .map((policy) => {
        const reviewDate = policy.policy_metadata?.review_date;
        if (!reviewDate) return null;
        const parsed = new Date(reviewDate);
        if (Number.isNaN(parsed.getTime())) return null;
        const days = Math.ceil((parsed.getTime() - now) / (1000 * 60 * 60 * 24));
        return { policy, days };
      })
      .filter((item): item is { policy: PolicyBundle; days: number } => item !== null && item.days <= 90)
      .sort((a, b) => a.days - b.days)
      .slice(0, 8);
  }, [policies]);

  const recommendations = useMemo(() => {
    const items: { id: string; tone: Tone; text: string }[] = [];

    if (pending.length > 0) {
      const oldest = [...pending].sort((a, b) => {
        const aTime = new Date(a.submitted_at ?? a.created_at).getTime();
        const bTime = new Date(b.submitted_at ?? b.created_at).getTime();
        return aTime - bTime;
      })[0];
      const started = oldest.submitted_at ?? oldest.created_at;
      const days = Math.max(
        0,
        Math.floor((Date.now() - new Date(started).getTime()) / (1000 * 60 * 60 * 24)),
      );
      if (days >= 3) {
        items.push({
          id: "oldest",
          tone: days >= 14 ? "danger" : "warning",
          text: `أقدم سياسة بانتظار الاعتماد "${oldest.title}" منذ ${days} يومًا — يُنصح بمراجعتها أولاً.`,
        });
      }
    }

    const busiestDept = [...departmentRows].filter((row) => row.pending > 0).sort((a, b) => b.pending - a.pending)[0];
    if (busiestDept && busiestDept.pending > 1) {
      items.push({
        id: "department",
        tone: "warning",
        text: `"${busiestDept.label}" لديها ${busiestDept.pending} سياسة بانتظار الاعتماد، الأكثر بين الإدارات.`,
      });
    }

    const overdue = upcomingReviews.filter((item) => item.days < 0).length;
    if (overdue > 0) {
      items.push({
        id: "overdue",
        tone: "danger",
        text: `${overdue} سياسة تجاوزت تاريخ مراجعتها المحدد — يُنصح بجدولتها في أقرب وقت.`,
      });
    }

    const dueSoon = upcomingReviews.filter((item) => item.days >= 0 && item.days <= 30).length;
    if (dueSoon > 0) {
      items.push({
        id: "due-soon",
        tone: "info",
        text: `${dueSoon} سياسة مستحقة المراجعة خلال ٣٠ يومًا القادمة.`,
      });
    }

    if (items.length === 0) {
      items.push({
        id: "clear",
        tone: "success",
        text: "لا توجد توصيات عاجلة حاليًا — جميع السياسات ضمن الجدول المتوقع.",
      });
    }

    return items.slice(0, 4);
  }, [pending, departmentRows, upcomingReviews]);

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
      title: "اعتماد التقارير المعلّقة",
      body: `سيُعتمد ${pending.length} من السياسات ويُتاح نشرها. لا يمكن التراجع عن هذا الإجراء دون مراجعة.`,
      confirmLabel: "اعتماد",
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
      toast.error("اكتب ملاحظة قبل المتابعة.");
      return;
    }
    setBusy(policy.id);
    try {
      const { error } = await supabase.rpc("ceo_return_policy", {
        p_policy_id: policy.id,
        p_comment: note.trim(),
      });
      if (error) throw error;
      toast.success("أُعيدت السياسة مع الملاحظات.");
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
        <div className="seal-stage" role="status" aria-live="polite">
          <div className="hero-seal seal-stage-mark" aria-hidden="true">
            <div className="ring" />
            <div className="ring inner" />
            <div className="glyph">ج١</div>
          </div>
          <p>تم الاعتماد</p>
        </div>
      ) : null}

      <header className="topbar">
        <div className="wrap topbar-inner">
          <div className="lockup">
            <div className="seal" aria-hidden="true">
              ج١
            </div>
            <div className="lockup-text">
              <span className="primary">تجمع جدة الصحي الأول</span>
              <span className="secondary">مكتب الرئيس التنفيذي</span>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="profile-chip">
              <span className="profile-avatar" aria-hidden="true">
                {initials(profile.full_name)}
              </span>
              <span className="profile-text">
                <span className="primary">{profile.full_name ?? "الرئيس التنفيذي"}</span>
                <span className="secondary">الرئيس التنفيذي</span>
              </span>
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => void signOut()}>
              خروج
            </button>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="wrap hero-grid">
          <div className="reveal in">
            <span className="eyebrow">
              {greeting()}
              {firstName ? `، ${firstName}` : ""} · {todayFmt.format(new Date())}
            </span>
            <h1 className="display-l">{pending.length} سياسة بانتظار الاعتماد</h1>
            <p className="lede">راجع الوثيقة وسياقها الكامل، ثم اعتمد.</p>
            <div className="brass-rule in" data-brass />
            {pending.length > 0 ? (
              <button
                type="button"
                className="btn btn-primary hero-cta"
                disabled={approvingAll}
                onClick={() => void approveAll()}
              >
                {approvingAll ? "جاري الاعتماد..." : `اعتماد الكل (${pending.length})`}
              </button>
            ) : null}
          </div>

          <div className="hero-seal reveal in" aria-hidden="true">
            <div className="ring" />
            <div className="ring inner" />
            <div className="glyph">ج١</div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="grid grid-4 stagger in">
            <div className="kpi">
              <span className="eyebrow">بانتظار الاعتماد</span>
              <div className="value brass">{pending.length}</div>
            </div>
            <div className="kpi">
              <span className="eyebrow">مُعتمد</span>
              <div className="value">{finalised.length}</div>
            </div>
            <div className="kpi">
              <span className="eyebrow">نسبة الإنجاز</span>
              <div className="value">{completion}٪</div>
            </div>
            <div className="kpi">
              <span className="eyebrow">متوسط زمن الاعتماد</span>
              <div className="value">{avgApprovalDays !== null ? `${avgApprovalDays} يوم` : "—"}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head reveal" ref={recsHeadRef}>
            <span className="eyebrow">التوصيات</span>
            <h2>ما يستحق انتباهك الآن</h2>
            <div className="brass-rule" data-brass style={{ maxInlineSize: "180px", marginBlockStart: "var(--s-4)" }} />
          </div>
          <div className="rec-list reveal" ref={recsRef}>
            {recommendations.map((item) => (
              <div className="rec-item" key={item.id}>
                <span className={`dot ${item.tone}`} aria-hidden="true" />
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head reveal" ref={queueHeadRef}>
            <span className="eyebrow">بانتظار الاعتماد</span>
            <h2>السياسات</h2>
            <div className="brass-rule" data-brass style={{ maxInlineSize: "180px", marginBlockStart: "var(--s-4)" }} />
            {pending.length > 3 ? (
              <div className="field" style={{ marginBlockStart: "var(--s-5)", maxInlineSize: "360px" }}>
                <input
                  className="input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="ابحث عن سياسة"
                />
              </div>
            ) : null}
          </div>

          {loading ? (
            <p className="muted">جاري التحميل...</p>
          ) : visiblePending.length === 0 ? (
            <div className="empty">
              <div className="mark" aria-hidden="true">
                ✓
              </div>
              <h3>{pending.length === 0 ? "لا شيء بانتظار الاعتماد" : "لا توجد نتائج"}</h3>
              <p>
                {pending.length === 0
                  ? "جميع السياسات معتمدة."
                  : "جرّب كلمات بحث مختلفة."}
              </p>
            </div>
          ) : (
            <div className="grid" ref={queueListRef}>
              {visiblePending.map((policy) => {
                const classification = classifyPolicy(policy);
                const isOpen = openId === policy.id;
                const isExpanded = expandedId === policy.id;
                return (
                  <article className={`card queue-card${isExpanded ? " is-open" : ""}`} key={policy.id}>
                    <button
                      type="button"
                      className="queue-card-toggle"
                      aria-expanded={isExpanded}
                      onClick={() => setExpandedId(isExpanded ? null : policy.id)}
                    >
                      <span className="queue-card-summary">
                        <span className="pill warning">قيد المراجعة</span>
                        <h3>{policy.title}</h3>
                        <span className="caption" dir="ltr" style={{ textAlign: "start" }}>
                          {policyReference(policy) ?? "—"}
                        </span>
                      </span>
                      <span className="caption">{classification.departmentLabel}</span>
                      <span className="chevron" aria-hidden="true" />
                    </button>

                    {isExpanded ? (
                      <div className="queue-card-body">
                        <div className="meta-grid">
                          <div>
                            <p className="caption">تاريخ الإصدار</p>
                            <p>{formatDate(policy.policy_metadata?.issue_date)}</p>
                          </div>
                          <div>
                            <p className="caption">تاريخ المراجعة</p>
                            <p>{formatDate(policy.policy_metadata?.review_date)}</p>
                          </div>
                        </div>

                        <div className="demo-row" style={{ marginBlockStart: "var(--s-5)" }}>
                          <button type="button" className="btn btn-secondary" onClick={() => void openDocument(policy)}>
                            عرض الوثيقة
                          </button>
                          <button
                            type="button"
                            className="btn btn-quiet"
                            onClick={() => {
                              setOpenId(isOpen ? null : policy.id);
                              setNote("");
                            }}
                          >
                            {isOpen ? "إلغاء" : "إعادة مع ملاحظات"}
                          </button>
                        </div>

                        {isOpen ? (
                          <div style={{ marginBlockStart: "var(--s-5)" }}>
                            <div className="field">
                              <textarea
                                className="textarea"
                                value={note}
                                onChange={(event) => setNote(event.target.value)}
                                placeholder="سبب الإعادة"
                              />
                            </div>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={busy === policy.id}
                              onClick={() => void returnWithNote(policy)}
                            >
                              تأكيد الإعادة
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
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head reveal" ref={reviewsHeadRef}>
            <span className="eyebrow">المراجعات</span>
            <h2>مراجعات مستحقة قريباً</h2>
            <div className="brass-rule" data-brass style={{ maxInlineSize: "180px", marginBlockStart: "var(--s-4)" }} />
          </div>

          {upcomingReviews.length === 0 ? (
            <div className="empty">
              <div className="mark" aria-hidden="true">
                ✓
              </div>
              <h3>لا توجد مراجعات مستحقة خلال ٩٠ يوماً</h3>
              <p>تُقرأ هذه المواعيد من تاريخ المراجعة في ترويسة كل سياسة.</p>
            </div>
          ) : (
            <div className="table-scroll reveal" ref={reviewsRef}>
              <table className="data">
                <thead>
                  <tr>
                    <th>السياسة</th>
                    <th>الرمز</th>
                    <th>الإدارة</th>
                    <th>تاريخ المراجعة</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingReviews.map(({ policy, days }) => {
                    const classification = classifyPolicy(policy);
                    const urgency = reviewUrgency(days);
                    return (
                      <tr key={policy.id} onClick={() => void openDocument(policy)} style={{ cursor: "pointer" }}>
                        <td>{policy.title}</td>
                        <td dir="ltr" style={{ textAlign: "start" }}>
                          {policyReference(policy) ?? "—"}
                        </td>
                        <td>{classification.departmentLabel}</td>
                        <td>{formatDate(policy.policy_metadata?.review_date)}</td>
                        <td>
                          <span className={`pill ${urgency.tone}`}>{urgency.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head reveal" ref={chartsHeadRef}>
            <span className="eyebrow">المؤشرات</span>
            <h2>الإدارات والاعتماد</h2>
            <div className="brass-rule" data-brass style={{ maxInlineSize: "180px", marginBlockStart: "var(--s-4)" }} />
          </div>

          <div className="grid grid-2 stagger" ref={chartsGridRef}>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>الإدارة</th>
                    <th className="num">مُعتمد</th>
                    <th className="num">بانتظار</th>
                    <th className="num">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {departmentRows.length === 0 ? (
                    <tr>
                      <td colSpan={4}>لا توجد بيانات.</td>
                    </tr>
                  ) : (
                    departmentRows.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td className="num">{row.approved}</td>
                        <td className="num">{row.pending}</td>
                        <td className="num">{row.total}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h3 style={{ marginBlockEnd: "var(--s-5)" }}>الاعتماد النهائي · ٦ أشهر</h3>
              <div className="trend-bars" role="img" aria-label="الاعتماد النهائي خلال الأشهر الستة الأخيرة">
                {trend.map((point, index) => (
                  <div className="trend-col" key={index} title={`${point.label}: ${point.count}`}>
                    <span className="trend-value">{point.count}</span>
                    <span className="trend-track">
                      <span
                        className="trend-fill"
                        style={{ blockSize: `${point.count > 0 ? Math.max(point.pct, 6) : 2}%` }}
                      />
                    </span>
                    <em className="trend-label">{point.label}</em>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head reveal" ref={registerHeadRef}>
            <span className="eyebrow">السجل</span>
            <h2>آخر الاعتمادات</h2>
            <div className="brass-rule" data-brass style={{ maxInlineSize: "180px", marginBlockStart: "var(--s-4)" }} />
          </div>

          {recentFinal.length === 0 ? (
            <div className="empty">
              <h3>لا يوجد سجل بعد</h3>
              <p>تظهر السياسات هنا فور اعتمادها.</p>
            </div>
          ) : (
            <div className="table-scroll reveal" ref={registerRef}>
              <table className="data">
                <thead>
                  <tr>
                    <th>السياسة</th>
                    <th>الرمز</th>
                    <th>تاريخ الإصدار</th>
                    <th>تاريخ المراجعة</th>
                    <th>تاريخ الاعتماد</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {recentFinal.map((policy) => (
                    <tr
                      key={policy.id}
                      onClick={() => void openDocument(policy)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>{policy.title}</td>
                      <td dir="ltr" style={{ textAlign: "start" }}>
                        {policyReference(policy) ?? "—"}
                      </td>
                      <td>{formatDate(policy.policy_metadata?.issue_date)}</td>
                      <td>{formatDate(policy.policy_metadata?.review_date)}</td>
                      <td>{formatDate(policy.final_approved_at)}</td>
                      <td>
                        <span className="pill success">مُعتمد</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {pending.length > 0 ? (
        <div className="dock">
          <span>
            <strong>{pending.length}</strong> سياسة بانتظار الاعتماد
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={approvingAll}
            onClick={() => void approveAll()}
          >
            {approvingAll ? "جاري الاعتماد..." : "اعتماد الكل"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
