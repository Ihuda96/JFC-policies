import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Clock,
  FilePlus2,
  FileStack,
  Timer,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { LoadingState } from "../components/LoadingState";
import { SetupRequired } from "../components/SetupRequired";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { buildExecutiveSummary } from "../lib/analytics";
import { policyReference } from "../lib/departments";
import { formatDate, roleLabels } from "../lib/format";
import { isSetupError, supabase } from "../lib/supabase";
import type { PolicyBundle } from "../lib/types";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "صباح الخير";
  if (hour < 17) return "طاب يومك";
  return "مساء الخير";
}

const todayLabel = new Intl.DateTimeFormat("ar", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
}).format(new Date());

export function DashboardPage() {
  const { profile } = useAuth();
  const [policies, setPolicies] = useState<PolicyBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!supabase) {
        return;
      }

      setLoading(true);
      const { data, error: queryError } = await supabase
        .from("policies")
        .select(
          "id,title,status,policy_number,owner_department,owner_id,created_at,updated_at,submitted_at,approved_at,next_review_at",
        )
        .neq("status", "archived");

      if (queryError) {
        if (isSetupError(queryError)) {
          setSetupError(queryError.message);
        } else {
          setError(queryError.message);
        }
      } else {
        setPolicies((data as PolicyBundle[]) ?? []);
      }
      setLoading(false);
    }

    void load();
  }, []);

  const summary = useMemo(
    () => buildExecutiveSummary(policies, profile?.id, profile?.role),
    [policies, profile],
  );

  if (setupError) {
    return <SetupRequired message={setupError} />;
  }

  if (loading) {
    return <LoadingState />;
  }

  const firstName = (profile?.full_name ?? "").split(" ")[0];

  const kpis = [
    { icon: FileStack, label: "السياسات النشطة", value: summary.total, sub: `${summary.approved} معتمدة` },
    { icon: Clock, label: "بانتظار الاعتماد", value: summary.pending, sub: `${summary.returned} معادة للتعديل` },
    {
      icon: AlertTriangle,
      label: "مراجعة متأخرة",
      value: summary.overdue,
      sub: `${summary.dueSoon} تقترب من المراجعة`,
      tone: summary.overdue > 0 ? "risk" : undefined,
    },
    { icon: Building2, label: "الإدارات المغطاة", value: summary.departmentsCovered, sub: "إدارة نشطة" },
    {
      icon: Timer,
      label: "متوسط زمن الاعتماد",
      value: summary.avgTurnaroundDays ?? "—",
      sub: summary.avgTurnaroundDays != null ? "يوم" : "لا توجد بيانات كافية",
    },
  ];

  return (
    <div className="page-stack">
      <section className="dash-hero">
        <div className="dash-hero-text">
          <p className="eyebrow">{profile ? roleLabels[profile.role] : "مستخدم"}</p>
          <h1>
            {greeting()}
            {firstName ? `، ${firstName}` : ""}
          </h1>
          <p>{todayLabel}</p>
        </div>
        {profile?.role !== "system_admin" ? (
          <Link className="dash-hero-cta" to="/app/upload">
            <FilePlus2 aria-hidden="true" />
            <span>إضافة سياسة</span>
          </Link>
        ) : null}
      </section>

      {error ? <p className="inline-error">{error}</p> : null}

      <section className="exec-kpis">
        {kpis.map((kpi) => (
          <article className={`kpi-card ${kpi.tone === "risk" ? "kpi-risk" : ""}`} key={kpi.label}>
            <span className="kpi-icon">
              <kpi.icon aria-hidden="true" />
            </span>
            <strong className="kpi-value">{kpi.value}</strong>
            <span className="kpi-label">{kpi.label}</span>
            <em className="kpi-sub">{kpi.sub}</em>
          </article>
        ))}
      </section>

      {summary.actions.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <h2>ما يحتاج إجراء</h2>
            <Link to="/app/actions">عرض الكل</Link>
          </div>
          <div className="dash-actions">
            {summary.actions.map((action) => (
              <Link className="dash-action" to={action.to} key={action.key}>
                <strong>{action.count}</strong>
                <span>{action.title}</span>
                <ArrowLeft aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="exec-charts">
        <article className="chart-card">
          <h2>توزيع الحالات</h2>
          {summary.statusBars.length === 0 ? (
            <p className="chart-empty">لا توجد بيانات.</p>
          ) : (
            <div className="bar-list">
              {summary.statusBars.map((bar) => (
                <div className="bar-row" key={bar.key} title={`${bar.label}: ${bar.count}`}>
                  <span className="bar-label">{bar.label}</span>
                  <span className="bar-track">
                    <span className="bar-fill" style={{ inlineSize: `${Math.max(bar.pct, 3)}%` }} />
                  </span>
                  <span className="bar-value">{bar.count}</span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="chart-card">
          <h2>أكثر الإدارات نشاطًا</h2>
          {summary.departmentBars.length === 0 ? (
            <p className="chart-empty">لا توجد بيانات.</p>
          ) : (
            <div className="bar-list">
              {summary.departmentBars.map((bar) => (
                <div className="bar-row" key={bar.key} title={`${bar.label}: ${bar.count}`}>
                  <span className="bar-label">{bar.label}</span>
                  <span className="bar-track">
                    <span className="bar-fill" style={{ inlineSize: `${Math.max(bar.pct, 3)}%` }} />
                  </span>
                  <span className="bar-value">{bar.count}</span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="chart-card">
          <h2>اعتمادات آخر ٦ أشهر</h2>
          <div className="mini-bars" role="img" aria-label="اعتمادات الأشهر الستة الأخيرة">
            {summary.trend.map((point, index) => (
              <div className="mini-bar-col" key={index} title={`${point.label}: ${point.count}`}>
                <span className="mini-bar-value">{point.count}</span>
                <span className="mini-bar-track">
                  <span
                    className="mini-bar-fill"
                    style={{ blockSize: `${point.count > 0 ? Math.max(point.pct, 6) : 2}%` }}
                  />
                </span>
                <em className="mini-bar-label">{point.label}</em>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="data-section">
        <div className="section-title-row">
          <h2>آخر النشاطات</h2>
          <Link to="/app/workspace">عرض الكل</Link>
        </div>
        {summary.recent.length === 0 ? (
          <div className="activity-empty">لا توجد سياسات مسجلة حتى الآن.</div>
        ) : (
          <ul className="activity-list">
            {summary.recent.map((policy) => (
              <li key={policy.id}>
                <Link to={`/app/policies/${policy.id}`} className="activity-row">
                  <div className="activity-main">
                    <strong>{policy.title}</strong>
                    <span className="activity-meta">
                      {policyReference(policy) ?? "بدون رقم"} · {formatDate(policy.updated_at)}
                    </span>
                  </div>
                  <StatusBadge status={policy.status} />
                  <ArrowLeft className="activity-chevron" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
