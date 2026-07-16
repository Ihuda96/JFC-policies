import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { SetupRequired } from "../components/SetupRequired";
import { StatusBadge } from "../components/StatusBadge";
import {
  approvePolicyVersion,
  readableWorkflowError,
  returnPolicyForRevision,
} from "../lib/policyWorkflow";
import { formatDate } from "../lib/format";
import { isSetupError, supabase } from "../lib/supabase";
import type { PolicyBundle, PolicyVersion } from "../lib/types";

function latestVersion(policy: PolicyBundle) {
  return [...(policy.policy_versions ?? [])].sort(
    (a, b) => b.version_number - a.version_number,
  )[0];
}

export function ApprovalsPage() {
  const [policies, setPolicies] = useState<PolicyBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [active, setActive] = useState<string | null>(null);

  async function load() {
    if (!supabase) {
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from("policies")
      .select("*, policy_versions(*), profiles:owner_id(full_name,email)")
      .in("status", ["pending_approval", "resubmitted"])
      .order("submitted_at", { ascending: true });

    if (error) {
      if (isSetupError(error)) {
        setSetupError(error.message);
      }
    } else {
      setPolicies((data as PolicyBundle[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function approve(policyId: string, version?: PolicyVersion) {
    if (!version) {
      return;
    }

    setActive(policyId);
    setActionError(null);
    try {
      await approvePolicyVersion(policyId, version.id);
      await load();
    } catch (err) {
      setActionError(readableWorkflowError(err));
    } finally {
      setActive(null);
    }
  }

  async function returnForRevision(event: FormEvent<HTMLFormElement>, policyId: string, version?: PolicyVersion) {
    event.preventDefault();
    if (!version) {
      return;
    }

    setActive(policyId);
    setActionError(null);
    try {
      await returnPolicyForRevision({
        policyId,
        versionId: version.id,
        comment,
      });
      setComment("");
      await load();
    } catch (err) {
      setActionError(readableWorkflowError(err));
    } finally {
      setActive(null);
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
      <section className="page-hero compact">
        <div>
          <p className="eyebrow">مدير الجودة</p>
          <h1>طلبات الاعتماد</h1>
          <p>اعتماد مدير الجودة هو نقطة النشر النهائية في الإصدار الأول.</p>
        </div>
      </section>
      {actionError ? <p className="inline-error">{actionError}</p> : null}
      <div className="approval-list">
        {policies.map((policy) => {
          const version = latestVersion(policy);
          return (
            <article className="approval-card" key={policy.id}>
              <div className="approval-main">
                <StatusBadge status={policy.status} />
                <h2>{policy.title}</h2>
                <p>
                  النسخة {version?.version_number ?? "-"} · المالك{" "}
                  {policy.profiles?.full_name ?? policy.profiles?.email ?? "غير محدد"} ·{" "}
                  {formatDate(policy.submitted_at)}
                </p>
                <Link to={`/app/policies/${policy.id}`}>فتح المعاينة والتفاصيل</Link>
              </div>
              <div className="approval-actions">
                <button
                  className="primary-button full"
                  onClick={() => void approve(policy.id, version)}
                  disabled={active === policy.id}
                >
                  <CheckCircle2 aria-hidden="true" />
                  اعتماد ونشر
                </button>
                <form onSubmit={(event) => void returnForRevision(event, policy.id, version)}>
                  <textarea
                    required
                    placeholder="ملاحظات الإعادة للتعديل"
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                  />
                  <button className="secondary-button full" disabled={active === policy.id}>
                    <RotateCcw aria-hidden="true" />
                    إعادة للتعديل
                  </button>
                </form>
              </div>
            </article>
          );
        })}
        {policies.length === 0 ? (
          <div className="empty-state">
            <h3>لا توجد طلبات تنتظر القرار</h3>
            <p>ستظهر هنا السياسات المرسلة أو المعاد إرسالها.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
