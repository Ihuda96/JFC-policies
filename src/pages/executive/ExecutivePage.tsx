import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { classifyPolicy, policyReference } from "../../lib/departments";
import { formatDate } from "../../lib/format";
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

  const heroTextRef = useReveal<HTMLDivElement>();
  const heroSealRef = useReveal<HTMLDivElement>();
  const kpiRef = useReveal<HTMLDivElement>();
  const queueHeadRef = useReveal<HTMLDivElement>();
  const queueListRef = useReveal<HTMLDivElement>();
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
    const counts = new Map<string, number>();
    for (const policy of policies) {
      const label = classifyPolicy(policy).departmentLabel;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [policies]);

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
          <button type="button" className="btn btn-secondary" onClick={() => void signOut()}>
            خروج
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="wrap hero-grid">
          <div className="reveal" ref={heroTextRef}>
            <span className="eyebrow">
              {greeting()}
              {firstName ? `، ${firstName}` : ""}
            </span>
            <h1 className="display-l">{pending.length} سياسة بانتظار الاعتماد</h1>
            <p className="lede">راجع الوثيقة وسياقها الكامل، ثم اعتمد.</p>
            <div className="brass-rule" data-brass />
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

          <div className="hero-seal reveal" aria-hidden="true" ref={heroSealRef}>
            <div className="ring" />
            <div className="ring inner" />
            <div className="glyph">ج١</div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="grid grid-3 stagger" ref={kpiRef}>
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
                return (
                  <article className="card" key={policy.id}>
                    <div className="demo-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <span className="pill warning">قيد المراجعة</span>
                        <h3 style={{ marginBlockStart: "var(--s-3)" }}>{policy.title}</h3>
                        <p className="caption" dir="ltr" style={{ textAlign: "start" }}>
                          {policyReference(policy) ?? "—"}
                        </p>
                      </div>
                      <span className="caption">{classification.departmentLabel}</span>
                    </div>

                    <div className="demo-row" style={{ marginBlockStart: "var(--s-5)", gap: "var(--s-7)" }}>
                      <div>
                        <p className="caption">اعتماد الجودة</p>
                        <p>{formatDate(policy.approved_at)}</p>
                      </div>
                      <div>
                        <p className="caption">المراجعة القادمة</p>
                        <p>{formatDate(policy.next_review_at)}</p>
                      </div>
                    </div>

                    <div className="demo-row" style={{ marginBlockStart: "var(--s-6)" }}>
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
                  </article>
                );
              })}
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
                    <th className="num">السياسات</th>
                  </tr>
                </thead>
                <tbody>
                  {departmentRows.length === 0 ? (
                    <tr>
                      <td colSpan={2}>لا توجد بيانات.</td>
                    </tr>
                  ) : (
                    departmentRows.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td className="num">{row.count}</td>
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
