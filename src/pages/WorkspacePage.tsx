import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { SetupRequired } from "../components/SetupRequired";
import { StatusBadge } from "../components/StatusBadge";
import { formatDate } from "../lib/format";
import { isSetupError, supabase } from "../lib/supabase";
import type { Policy } from "../lib/types";

export function WorkspacePage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!supabase) {
        return;
      }

      setLoading(true);
      const { data, error } = await supabase
        .from("policies")
        .select("*, profiles:profiles!policies_owner_id_fkey(full_name,email)")
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
          <p className="eyebrow">السياسات قيد العمل</p>
          <h1>سياساتي</h1>
          <p>تعرض القائمة ما تسمح به صلاحيات RLS للمستخدم الحالي.</p>
        </div>
      </section>
      {policies.length === 0 ? (
        <EmptyState title="لا توجد سياسات" body="ابدأ بإضافة سياسة جديدة من شاشة الرفع." />
      ) : (
        <div className="cards-list">
          {policies.map((policy) => (
            <article className="policy-card" key={policy.id}>
              <div>
                <StatusBadge status={policy.status} />
                <h2>{policy.title}</h2>
                <p>{policy.policy_number ?? "لم يتم استخراج رقم السياسة بعد"}</p>
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
              <Link className="secondary-button" to={`/app/policies/${policy.id}`}>
                فتح السياسة
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
