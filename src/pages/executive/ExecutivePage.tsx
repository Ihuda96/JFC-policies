import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  Building2,
  Check,
  CheckCheck,
  FileText,
  LogOut,
  Search,
  ShieldCheck,
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
const arabicIndicNumeral = new Intl.NumberFormat("ar-SA");

function sectionNumeral(n: number) {
  return arabicIndicNumeral.format(n).padStart(2, "٠");
}

function pct(count: number, max: number) {
  return max > 0 ? Math.round((count / max) * 100) : 0;
}

function daysSince(iso: string | null) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.max(0, Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000)));
  return days;
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

  const recentFinal = useMemo(() => finalised.slice(0, 8), [finalised]);

  const departmentsActive = useMemo(() => {
    const set = new Set<string>();
    for (const policy of policies) {
      set.add(classifyPolicy(policy).departmentLabel);
    }
    return set.size;
  }, [policies]);

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
      body: `سيتم اعتماد ${pending.length} سياسة بشكل نهائي ونشرها في المكتبة الرسمية. لا يمكن التراجع عن هذا القرار.`,
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
      toast.error("اكتب سبب الإعادة قبل المتابعة.");
      return;
    }
    setBusy(policy.id);
    try {
      const { error } = await supabase.rpc("ceo_return_policy", {
        p_policy_id: policy.id,
        p_comment: note.trim(),
      });
      if (error) throw error;
      toast.success("أُعيدت السياسة للمراجعة مع ملاحظاتك.");
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
        <div className="gov-seal-stage" role="status" aria-live="polite">
          <div className="gov-seal-mark">
            <Check aria-hidden="true" />
          </div>
          <p>تم تسجيل الاعتماد النهائي</p>
        </div>
      ) : null}

      <header className="gov-topbar">
        <div className="gov-topbar-brand">
          <span className="gov-mark">JF</span>
          <div>
            <strong>الحوكمة التنفيذية</strong>
            <span>تجمع جدة الصحي الأول · جلسة آمنة</span>
          </div>
        </div>
        <button type="button" className="gov-btn" onClick={() => void signOut()}>
          <LogOut aria-hidden="true" />
          خروج
        </button>
      </header>

      <main className="gov-content">
        <section className="gov-hero">
          <div className="gov-hero-ring" aria-hidden="true" />
          <p className="gov-eyebrow">مكتب الرئيس التنفيذي · نظام الحوكمة التنفيذية للسياسات</p>
          <h1>
            {pending.length} سياسة بانتظار قرارك
          </h1>
          <p className="gov-hero-lead">
            {greeting()}
            {firstName ? `، ${firstName}` : ""}. راجع القرار وسياقه الكامل، ثم اعتمد بثقة.
          </p>
          <div className="gov-pillrow">
            <span className="gov-pill">{dateLabel}</span>
            <span className="gov-pill">{finalised.length} معتمدة نهائيًا</span>
            <span className="gov-pill">{completion}٪ نسبة الإنجاز</span>
            <span className="gov-pill">{departmentsActive} إدارة نشطة</span>
          </div>
          {pending.length > 0 ? (
            <button
              type="button"
              className="gov-btn-primary gov-hero-cta"
              disabled={approvingAll}
              onClick={() => void approveAll()}
            >
              <CheckCheck aria-hidden="true" />
              {approvingAll ? "جاري الاعتماد..." : `اعتماد الكل (${pending.length})`}
            </button>
          ) : null}
        </section>

        <section className="gov-section" aria-labelledby="gov-queue-title">
          <div className="gov-section-head">
            <span className="gov-num">{sectionNumeral(1)}</span>
            <div>
              <h2 id="gov-queue-title">قائمة القرارات</h2>
              <p className="gov-lead">
                سياسات اجتازت مراجعة الجودة وتنتظر اعتمادك النهائي.
              </p>
            </div>
            {pending.length > 3 ? (
              <label className="gov-search">
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
            <p className="gov-empty">
              {pending.length === 0 ? "لا شيء ينتظر قرارك حاليًا." : "لا توجد نتائج مطابقة."}
            </p>
          ) : (
            <div className="gov-decision-list">
              {visiblePending.map((policy) => {
                const classification = classifyPolicy(policy);
                const isOpen = openId === policy.id;
                const waiting = daysSince(policy.approved_at);
                return (
                  <article className="gov-decision-card" key={policy.id}>
                    <div className="gov-decision-head">
                      <div className="gov-decision-title">
                        <span className="gov-chip gov-chip-teal">اعتماد تنفيذي</span>
                        {waiting !== null && waiting > 0 ? (
                          <span className="gov-chip gov-chip-warning">
                            بالانتظار {waiting} {waiting === 1 ? "يوم" : "أيام"}
                          </span>
                        ) : null}
                        <h3>{policy.title}</h3>
                        <span className="gov-decision-code" dir="ltr">
                          {policyReference(policy) ?? "—"}
                        </span>
                      </div>
                      <span className="gov-decision-dept">
                        <Building2 aria-hidden="true" />
                        {classification.departmentLabel}
                      </span>
                    </div>

                    <dl className="gov-decision-meta">
                      <div>
                        <dt>اعتماد الجودة</dt>
                        <dd>{formatDate(policy.approved_at)}</dd>
                      </div>
                      <div>
                        <dt>المراجعة القادمة</dt>
                        <dd>{formatDate(policy.next_review_at)}</dd>
                      </div>
                    </dl>

                    <p className="gov-assurance-line">
                      <ShieldCheck aria-hidden="true" />
                      اجتازت جميع مراجعات الجودة المطلوبة
                    </p>

                    <div className="gov-decision-actions">
                      <button
                        type="button"
                        className="gov-btn"
                        onClick={() => void openDocument(policy)}
                      >
                        <FileText aria-hidden="true" />
                        عرض الوثيقة
                      </button>
                      <button
                        type="button"
                        className="gov-btn-text"
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
                      <div className="gov-return-panel">
                        <textarea
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          placeholder="سبب الإعادة — يظهر لصاحب السياسة"
                          rows={3}
                        />
                        <button
                          type="button"
                          className="gov-btn-danger"
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

        <section className="gov-section" aria-labelledby="gov-snapshot-title">
          <div className="gov-section-head">
            <span className="gov-num">{sectionNumeral(2)}</span>
            <div>
              <h2 id="gov-snapshot-title">لمحة الحوكمة</h2>
              <p className="gov-lead">أكثر الإدارات إصدارًا، ووتيرة الاعتماد النهائي.</p>
            </div>
          </div>

          <div className="gov-panels">
            <article className="gov-panel">
              <h3>أكثر الإدارات إصدارًا للسياسات</h3>
              {departmentBars.length === 0 ? (
                <p className="gov-empty">لا توجد بيانات.</p>
              ) : (
                <div className="gov-bar-list">
                  {departmentBars.map((bar) => (
                    <div className="gov-bar-row" key={bar.key} title={`${bar.label}: ${bar.count}`}>
                      <span className="gov-bar-label">{bar.label}</span>
                      <span className="gov-bar-track">
                        <span className="gov-bar-fill" style={{ inlineSize: `${Math.max(bar.pct, 3)}%` }} />
                      </span>
                      <span className="gov-bar-value">{bar.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="gov-panel">
              <h3>الاعتمادات النهائية · آخر ٦ أشهر</h3>
              <div className="gov-mini-bars" role="img" aria-label="الاعتمادات النهائية خلال الأشهر الستة الأخيرة">
                {trend.map((point, index) => (
                  <div className="gov-mini-bar-col" key={index} title={`${point.label}: ${point.count}`}>
                    <span className="gov-mini-bar-value">{point.count}</span>
                    <span className="gov-mini-bar-track">
                      <span
                        className="gov-mini-bar-fill"
                        style={{ blockSize: `${point.count > 0 ? Math.max(point.pct, 6) : 2}%` }}
                      />
                    </span>
                    <em className="gov-mini-bar-label">{point.label}</em>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>

        <section className="gov-section" aria-labelledby="gov-register-title">
          <div className="gov-section-head">
            <span className="gov-num">{sectionNumeral(3)}</span>
            <div>
              <h2 id="gov-register-title">سجل الاعتمادات النهائية</h2>
              <p className="gov-lead">آخر القرارات الموثّقة في المكتبة الرسمية.</p>
            </div>
          </div>

          {recentFinal.length === 0 ? (
            <p className="gov-empty">لا توجد سياسات معتمدة نهائيًا بعد.</p>
          ) : (
            <ol className="gov-timeline">
              {recentFinal.map((policy) => (
                <li key={policy.id}>
                  <button
                    type="button"
                    className="gov-timeline-item"
                    onClick={() => void openDocument(policy)}
                  >
                    <span className="gov-timeline-dot" aria-hidden="true">
                      <Check aria-hidden="true" />
                    </span>
                    <span className="gov-timeline-body">
                      <strong>{policy.title}</strong>
                      <span className="gov-timeline-meta">
                        {policyReference(policy) ?? "—"} · {formatDate(policy.final_approved_at)}
                      </span>
                    </span>
                    <span className="gov-chip gov-chip-success">معتمدة نهائيًا</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <footer className="gov-footer">
          <p>الوضوح قبل الاعتماد</p>
          <span dir="ltr">Clarity before approval.</span>
        </footer>
      </main>

      {pending.length > 0 ? (
        <div className="gov-dock">
          <span>
            <strong>{pending.length}</strong> سياسة بانتظار الاعتماد النهائي
          </span>
          <button
            type="button"
            className="gov-btn-primary"
            disabled={approvingAll}
            onClick={() => void approveAll()}
          >
            <CheckCheck aria-hidden="true" />
            {approvingAll ? "جاري الاعتماد..." : "اعتماد الكل"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
