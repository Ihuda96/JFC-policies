import { AlertCircle, CheckCircle2, Clock, FilePlus2, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { MetricCard } from "../components/MetricCard";
import { LoadingState } from "../components/LoadingState";
import { SetupRequired } from "../components/SetupRequired";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { formatDate, roleLabels } from "../lib/format";
import { isSetupError, supabase } from "../lib/supabase";
import type { Policy } from "../lib/types";

export function DashboardPage() {
  const { profile } = useAuth();
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
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(12);

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

  const stats = useMemo(
    () => ({
      total: policies.length,
      pending: policies.filter((policy) => ["pending_approval", "resubmitted"].includes(policy.status)).length,
      returned: policies.filter((policy) => policy.status === "returned_for_revision").length,
      approved: policies.filter((policy) => policy.status === "approved").length,
    }),
    [policies],
  );

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
          <p className="eyebrow">{profile ? roleLabels[profile.role] : "مستخدم"}</p>
          <h1>الرئيسية</h1>
          <p>متابعة السياسات التي تحتاج رفعًا أو مراجعة أو اعتمادًا.</p>
        </div>
        {profile?.role !== "system_admin" ? (
          <Link className="primary-button" to="/app/upload">
            <FilePlus2 aria-hidden="true" />
            إضافة سياسة
          </Link>
        ) : null}
      </section>

      <section className="metrics-grid">
        <MetricCard icon={FileText} title="إجمالي السياسات" value={stats.total} />
        <MetricCard icon={Clock} title="بانتظار الاعتماد" value={stats.pending} />
        <MetricCard icon={AlertCircle} title="معادة للتعديل" value={stats.returned} />
        <MetricCard icon={CheckCircle2} title="معتمدة" value={stats.approved} />
      </section>

      <section className="data-section">
        <div className="section-title-row">
          <h2>آخر النشاطات</h2>
          <Link to="/app/workspace">عرض الكل</Link>
        </div>
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>السياسة</th>
                <th>الحالة</th>
                <th>آخر تحديث</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => (
                <tr key={policy.id}>
                  <td>
                    <strong>{policy.title}</strong>
                    <span>{policy.policy_number ?? "بدون رقم"}</span>
                  </td>
                  <td><StatusBadge status={policy.status} /></td>
                  <td>{formatDate(policy.updated_at)}</td>
                  <td><Link to={`/app/policies/${policy.id}`}>فتح</Link></td>
                </tr>
              ))}
              {policies.length === 0 ? (
                <tr>
                  <td colSpan={4}>لا توجد سياسات مسجلة حتى الآن.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
