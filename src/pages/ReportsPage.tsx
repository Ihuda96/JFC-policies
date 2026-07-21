import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Copy,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LoadingState } from "../components/LoadingState";
import { MetricCard } from "../components/MetricCard";
import { SetupRequired } from "../components/SetupRequired";
import { useToast } from "../components/Toast";
import { buildComplianceReport, type DeptHealth } from "../lib/analytics";
import { isSetupError, supabase } from "../lib/supabase";
import type { PolicyBundle } from "../lib/types";

const HEALTH_META: Record<
  DeptHealth,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  good: { label: "محدّثة", icon: CheckCircle2, className: "hm-good" },
  attention: { label: "تحتاج متابعة", icon: Clock, className: "hm-attention" },
  risk: { label: "مراجعة متأخرة", icon: AlertTriangle, className: "hm-risk" },
};

export function ReportsPage() {
  const [policies, setPolicies] = useState<PolicyBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    async function load() {
      if (!supabase) {
        return;
      }

      setLoading(true);
      const { data, error } = await supabase
        .from("policies")
        .select("*")
        .neq("status", "archived");
      if (error) {
        if (isSetupError(error)) {
          setSetupError(error.message);
        }
      } else {
        setPolicies((data as PolicyBundle[]) ?? []);
      }
      setLoading(false);
    }

    void load();
  }, []);

  const report = useMemo(() => buildComplianceReport(policies), [policies]);

  if (setupError) {
    return <SetupRequired message={setupError} />;
  }

  if (loading) {
    return <LoadingState />;
  }

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(
        `حالة السياسات\n\n${report.brief.join("\n")}`,
      );
      toast.success("تم نسخ ملخّص حالة السياسات.");
    } catch {
      toast.error("تعذّر نسخ الملخّص.");
    }
  }

  return (
    <div className="page-stack">
      <section className="page-hero compact">
        <div>
          <p className="eyebrow">مؤشرات الجودة</p>
          <h1>التقارير</h1>
          <p>نظرة شاملة على حالة السياسات حسب الإدارات.</p>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard icon={BarChart3} title="إجمالي السياسات" value={report.totals.total} />
        <MetricCard icon={CheckCircle2} title="معتمدة" value={report.totals.approved} />
        <MetricCard icon={Clock} title="قيد العمل" value={report.totals.inProgress} />
        <MetricCard icon={RotateCcw} title="مراجعة متأخرة" value={report.totals.overdue} />
      </section>

      <section className="data-section brief-section">
        <div className="section-title-row">
          <h2>ملخّص حالة السياسات</h2>
          <button type="button" className="text-button" onClick={() => void copyBrief()}>
            <Copy aria-hidden="true" />
            نسخ الملخّص
          </button>
        </div>
        <ul className="brief-list">
          {report.brief.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      </section>

      <section className="data-section">
        <div className="section-title-row">
          <h2>خريطة الالتزام حسب الإدارة</h2>
          <div className="heatmap-legend">
            {(Object.keys(HEALTH_META) as DeptHealth[]).map((key) => {
              const meta = HEALTH_META[key];
              return (
                <span className={`legend-chip ${meta.className}`} key={key}>
                  <meta.icon aria-hidden="true" />
                  {meta.label}
                </span>
              );
            })}
          </div>
        </div>

        {report.departments.length === 0 ? (
          <div className="note-box">لا توجد سياسات نشطة لعرضها بعد.</div>
        ) : (
          <div className="heatmap-grid">
            {report.departments.map((dept) => {
              const meta = HEALTH_META[dept.health];
              return (
                <article className={`heatmap-tile ${meta.className}`} key={dept.key}>
                  <header>
                    <div>
                      <h3>{dept.label}</h3>
                      {dept.code ? <code>{dept.code}</code> : null}
                    </div>
                    <span className="tile-status">
                      <meta.icon aria-hidden="true" />
                      {meta.label}
                    </span>
                  </header>
                  <strong className="tile-total">{dept.total}</strong>
                  <dl className="tile-breakdown">
                    <div>
                      <dt>معتمدة</dt>
                      <dd>{dept.approved}</dd>
                    </div>
                    <div>
                      <dt>قيد العمل</dt>
                      <dd>{dept.inProgress}</dd>
                    </div>
                    {dept.dueSoon > 0 ? (
                      <div>
                        <dt>قرب المراجعة</dt>
                        <dd>{dept.dueSoon}</dd>
                      </div>
                    ) : null}
                    {dept.overdue > 0 ? (
                      <div>
                        <dt>متأخرة</dt>
                        <dd>{dept.overdue}</dd>
                      </div>
                    ) : null}
                  </dl>
                </article>
              );
            })}
          </div>
        )}
        <p className="heatmap-note">
          مؤشرات المراجعة تعتمد على تاريخ المراجعة المقروء من ترويسة كل سياسة.
        </p>
      </section>
    </div>
  );
}
