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
      toast.success("تم الاعتماد النهائي.");
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

  if (!profile) {
    return <Navigate to="/executive/login" replace />;
  }

  if (!isExecutive(profile)) {
    return <Navigate to="/app" replace />;
  }

  if (profile.must_change_password) {
    return <ExecutiveSetPassword />;
  }

  const firstName = (profile.full_name ?? "").split(" ")[0];

  return (
    <main className="exec-portal">
      <div className="exec-aurora" aria-hidden="true" />

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

      <section className="exec-masthead">
        <p className="exec-date">{dateLabel}</p>
        <h1>
          أهلًا بك{firstName ? `، ${firstName}` : ""}
        </h1>
        <span className="exec-rule" />
        <div className="exec-figures">
          <div>
            <strong>{awaiting.length}</strong>
            <span>بانتظار الاعتماد النهائي</span>
          </div>
          <div>
            <strong>{finalised.length}</strong>
            <span>معتمدة نهائيًا</span>
          </div>
          <div>
            <strong>{policies.length}</strong>
            <span>إجمالي السياسات</span>
          </div>
        </div>
      </section>

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

      <label className="exec-search">
        <Search aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث عن سياسة"
        />
      </label>

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
                    <h2>{policy.title}</h2>
                    <span dir="ltr">{policyReference(policy) ?? "—"}</span>
                  </div>
                  <div className="exec-card-side">
                    <span className="exec-dept">{classification.departmentLabel}</span>
                    {done ? (
                      <span className="exec-seal">معتمدة نهائيًا</span>
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
    </main>
  );
}
