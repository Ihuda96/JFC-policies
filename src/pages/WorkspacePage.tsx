import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { SetupRequired } from "../components/SetupRequired";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../lib/format";
import { policyReference } from "../lib/departments";
import { archivePolicy, readableWorkflowError } from "../lib/policyWorkflow";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { isSetupError, supabase } from "../lib/supabase";
import type { Policy } from "../lib/types";

export function WorkspacePage() {
  const { profile } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!supabase) {
        return;
      }

      setLoading(true);
      const { data, error } = await supabase
        .from("policies")
        .select("*, profiles:profiles!policies_owner_id_fkey(full_name,email)")
        .neq("status", "archived")
        .order("updated_at", { ascending: false });

      if (error) {
        if (isSetupError(error)) {
          setSetupError(error.message);
        }
      } else {
        setPolicies((data as Policy[]) ?? []);
      }
      setLoading(false);
    }

    void load();
  }, []);

  function canRemove(policy: Policy) {
    if (policy.status === "archived") {
      return false;
    }

    if (profile?.role === "quality_manager") {
      return true;
    }

    return (
      policy.owner_id === profile?.id &&
      ["draft", "returned_for_revision"].includes(policy.status)
    );
  }

  async function removePolicy(policy: Policy) {
    const confirmed = await confirm({
      title: "حذف السياسة",
      body: `سيتم حذف "${policy.title}" ونقلها إلى الأرشيف وإخفاؤها من القوائم.`,
      confirmLabel: "حذف",
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    setDeletingId(policy.id);
    setActionError(null);
    try {
      await archivePolicy(policy.id);
      setPolicies((current) => current.filter((item) => item.id !== policy.id));
      toast.success("تم حذف السياسة ونقلها إلى الأرشيف.");
    } catch (err) {
      const message = readableWorkflowError(err);
      setActionError(message);
      toast.error(message);
    } finally {
      setDeletingId(null);
    }
  }

  if (setupError) {
    return <SetupRequired message={setupError} />;
  }

  if (loading) {
    return <LoadingState />;
  }

  return (
    <div className="page-stack">
      <section className="dash-hero">
        <div className="dash-hero-text">
          <p className="eyebrow">السياسات قيد العمل</p>
          <h1>سياساتي</h1>
          <p>تعرض القائمة السياسات المتاحة لك حسب صلاحياتك.</p>
        </div>
      </section>
      {actionError ? <p className="inline-error">{actionError}</p> : null}
      {policies.length === 0 ? (
        <EmptyState title="لا توجد سياسات" body="ابدأ بإضافة سياسة جديدة من شاشة الرفع." />
      ) : (
        <div className="cards-list">
          {policies.map((policy) => (
            <article className="policy-card" key={policy.id}>
              <div>
                <StatusBadge status={policy.status} />
                <h2>{policy.title}</h2>
                <p>{policyReference(policy) ?? "لم يتم استخراج رقم السياسة بعد"}</p>
              </div>
              <dl>
                <div>
                  <dt>المالك</dt>
                  <dd>{policy.profiles?.full_name ?? policy.profiles?.email ?? "غير محدد"}</dd>
                </div>
                <div>
                  <dt>آخر تحديث</dt>
                  <dd>{formatDate(policy.updated_at)}</dd>
                </div>
              </dl>
              <div className="card-actions">
                <Link className="secondary-button" to={`/app/policies/${policy.id}`}>
                  فتح السياسة
                </Link>
                {canRemove(policy) ? (
                  <button
                    type="button"
                    className="icon-button danger"
                    onClick={() => void removePolicy(policy)}
                    disabled={deletingId === policy.id}
                    aria-label={`حذف ${policy.title}`}
                    title="حذف السياسة"
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
