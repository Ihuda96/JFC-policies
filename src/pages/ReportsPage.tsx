import { BarChart3, CheckCircle2, Clock, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LoadingState } from "../components/LoadingState";
import { MetricCard } from "../components/MetricCard";
import { SetupRequired } from "../components/SetupRequired";
import { isSetupError, supabase } from "../lib/supabase";
import type { Policy } from "../lib/types";

export function ReportsPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!supabase) {
        return;
      }

      setLoading(true);
      const { data, error } = await supabase.from("policies").select("*");
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

  const stats = useMemo(() => {
    const approved = policies.filter((policy) => policy.status === "approved");
    const returned = policies.filter((policy) => policy.status === "returned_for_revision");
    const pending = policies.filter((policy) => ["pending_approval", "resubmitted"].includes(policy.status));
    return { approved, returned, pending };
  }, [policies]);

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
          <p className="eyebrow">مؤشرات الجودة</p>
          <h1>التقارير</h1>
          <p>قراءات مباشرة من قاعدة البيانات حسب الصلاحيات الحالية.</p>
        </div>
      </section>
      <section className="metrics-grid">
        <MetricCard icon={BarChart3} title="إجمالي السياسات" value={policies.length} />
        <MetricCard icon={CheckCircle2} title="معتمدة" value={stats.approved.length} />
        <MetricCard icon={Clock} title="تنتظر القرار" value={stats.pending.length} />
        <MetricCard icon={RotateCcw} title="معادة للتعديل" value={stats.returned.length} />
      </section>
      <section className="data-section">
        <h2>ملاحظات التقرير</h2>
        <div className="note-box">
          التصدير الرسمي إلى Excel/PDF يحتاج خدمة خلفية أو Edge Function لاحقًا.
          الواجهة الحالية تعرض المؤشرات الحية ولا تستخدم بيانات تجريبية.
        </div>
      </section>
    </div>
  );
}
