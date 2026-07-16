import { Search } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { SetupRequired } from "../components/SetupRequired";
import { formatDate } from "../lib/format";
import { isSetupError, supabase } from "../lib/supabase";
import type { PolicyBundle } from "../lib/types";

export function LibraryPage() {
  const [policies, setPolicies] = useState<PolicyBundle[]>([]);
  const [query, setQuery] = useState("");
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
        .select("*, policy_metadata(*)")
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

  const filtered = useMemo(() => {
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
          <p className="eyebrow">المكتبة المعتمدة</p>
          <h1>مكتبة السياسات</h1>
          <p>السياسات المنشورة فقط تظهر هنا وفق RLS والصلاحيات.</p>
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
      {filtered.length === 0 ? (
        <EmptyState title="لا توجد نتائج" body="لا توجد سياسات معتمدة تطابق البحث الحالي." />
      ) : (
        <div className="library-grid">
          {filtered.map((policy) => (
            <article className="library-card" key={policy.id}>
              <span>{policy.policy_metadata?.issuing_department ?? policy.owner_department ?? "غير مصنف"}</span>
              <h2>{policy.policy_metadata?.extracted_title ?? policy.title}</h2>
              <p>{policy.policy_number ?? policy.policy_metadata?.extracted_policy_number ?? "بدون رقم"}</p>
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
      )}
    </div>
  );
}
