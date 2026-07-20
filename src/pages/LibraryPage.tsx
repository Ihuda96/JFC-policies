import { Building2, FolderTree, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { SetupRequired } from "../components/SetupRequired";
import { groupPoliciesByDepartment } from "../lib/departments";
import { formatDate } from "../lib/format";
import { isSetupError, supabase } from "../lib/supabase";
import type { PolicyBundle } from "../lib/types";

export function LibraryPage() {
  const [policies, setPolicies] = useState<PolicyBundle[]>([]);
  const [query, setQuery] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
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
        .select("*, policy_metadata:policy_metadata!policy_metadata_policy_id_fkey(*)")
        .eq("status", "approved")
        .order("approved_at", { ascending: false });

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

  const searched = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return policies;
    }

    return policies.filter((policy) => {
      const text = [
        policy.title,
        policy.policy_number,
        policy.owner_department,
        policy.policy_metadata?.extracted_title,
        policy.policy_metadata?.extracted_policy_number,
        policy.policy_metadata?.issuing_department,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return text.includes(normalized);
    });
  }, [policies, query]);

  // Department chips reflect the full approved library so they stay stable
  // while searching.
  const departments = useMemo(() => groupPoliciesByDepartment(policies), [policies]);

  const visibleDepartments = useMemo(() => {
    const groups = groupPoliciesByDepartment(searched);
    if (!selectedDepartment) {
      return groups;
    }
    return groups.filter((group) => group.key === selectedDepartment);
  }, [searched, selectedDepartment]);

  if (setupError) {
    return <SetupRequired message={setupError} />;
  }

  if (loading) {
    return <LoadingState />;
  }

  const hasResults = visibleDepartments.length > 0;

  return (
    <div className="page-stack">
      <section className="page-hero compact">
        <div>
          <p className="eyebrow">المكتبة المعتمدة</p>
          <h1>مكتبة السياسات</h1>
          <p>تظهر السياسات المعتمدة مرتبة حسب الإدارة المسؤولة ثم التصنيف الفرعي.</p>
        </div>
      </section>

      <label className="search-box">
        <Search aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث باسم السياسة أو رقمها أو الإدارة"
        />
      </label>

      {departments.length > 0 ? (
        <div className="library-filters" role="tablist" aria-label="تصفية حسب الإدارة">
          <button
            type="button"
            className={selectedDepartment === null ? "dept-chip active" : "dept-chip"}
            onClick={() => setSelectedDepartment(null)}
          >
            جميع الإدارات
            <span>{policies.length}</span>
          </button>
          {departments.map((department) => (
            <button
              key={department.key}
              type="button"
              className={
                selectedDepartment === department.key ? "dept-chip active" : "dept-chip"
              }
              onClick={() => setSelectedDepartment(department.key)}
            >
              {department.label}
              <span>{department.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      {!hasResults ? (
        <EmptyState title="لا توجد نتائج" body="لا توجد سياسات معتمدة تطابق البحث أو الإدارة المحددة." />
      ) : (
        <div className="library-departments">
          {visibleDepartments.map((department) => (
            <section className="library-department" key={department.key}>
              <header className="library-department-head">
                <div>
                  <Building2 aria-hidden="true" />
                  <h2>{department.label}</h2>
                  {department.code ? <code>{department.code}</code> : null}
                </div>
                <span>{department.count} سياسة</span>
              </header>

              {department.sections.map((section) => (
                <div className="library-section" key={section.key}>
                  {section.label ? (
                    <h3 className="library-section-head">
                      <FolderTree aria-hidden="true" />
                      {section.label}
                      {section.code ? <code>{section.code}</code> : null}
                      <span>{section.policies.length}</span>
                    </h3>
                  ) : null}

                  <div className="library-grid">
                    {section.policies.map((policy) => (
                      <article className="library-card" key={policy.id}>
                        <span>{section.label ?? department.label}</span>
                        <h4>{policy.policy_metadata?.extracted_title ?? policy.title}</h4>
                        <p>
                          {policy.policy_number ??
                            policy.policy_metadata?.extracted_policy_number ??
                            "بدون رقم"}
                        </p>
                        <dl>
                          <div>
                            <dt>تاريخ الاعتماد</dt>
                            <dd>{formatDate(policy.approved_at)}</dd>
                          </div>
                          <div>
                            <dt>المراجعة القادمة</dt>
                            <dd>{formatDate(policy.next_review_at)}</dd>
                          </div>
                        </dl>
                        <Link className="secondary-button full" to={`/app/policies/${policy.id}`}>
                          معاينة السياسة
                        </Link>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
