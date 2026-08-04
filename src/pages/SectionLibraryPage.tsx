import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { FileText, FileCheck2, Lock, Search } from "lucide-react";
import { hasSupabaseConfig } from "../lib/config";
import { formatDate } from "../lib/format";
import { errorMessage, supabase } from "../lib/supabase";
import { approvedPdfPublicUrl, stampPublicUrl } from "../lib/stamp";
import { PoweredBy } from "../components/PoweredBy";
import { SetupRequired } from "../components/SetupRequired";

interface SectionPolicy {
  id: string;
  title: string;
  policy_number: string | null;
  approved_at: string | null;
  final_approved_at: string | null;
  next_review_at: string | null;
  department_code: string | null;
  final_stamp_path: string | null;
  approved_pdf_path: string | null;
}

export function SectionLibraryPage() {
  const { code = "" } = useParams();
  const sectionCode = code.toUpperCase();
  const [label, setLabel] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [policies, setPolicies] = useState<SectionPolicy[] | null>(null);
  const [query, setQuery] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    void (async () => {
      const { data } = await supabase!.rpc("section_public_label", { p_code: sectionCode });
      if (!cancelled) {
        setLabel(typeof data === "string" ? data : null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sectionCode]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    if (!/^[0-9]{5}$/.test(accessCode)) {
      setError("الرمز مكوّن من ٥ أرقام.");
      return;
    }

    setChecking(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc("open_section_library", {
        p_code: sectionCode,
        p_access_code: accessCode,
      });
      if (rpcError) throw rpcError;

      const rows = (data as SectionPolicy[]) ?? [];
      if (rows.length === 0) {
        // No rows can mean a wrong code or an empty section; verify by
        // checking whether the section exists at all.
        setPolicies([]);
      } else {
        setPolicies(rows);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  }

  const visible = useMemo(() => {
    if (!policies) return [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return policies;
    return policies.filter((policy) =>
      [policy.title, policy.policy_number]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [policies, query]);

  if (!hasSupabaseConfig) {
    return <SetupRequired />;
  }

  if (label === null) {
    return (
      <main className="section-page">
        <section className="section-gate">
          <h1>الرمز غير معروف</h1>
          <p>تأكد من مسح الباركود الصحيح.</p>
        </section>
        <PoweredBy />
      </main>
    );
  }

  if (!policies) {
    return (
      <main className="section-page">
        <section className="section-gate">
          <span className="section-lock">
            <Lock aria-hidden="true" />
          </span>
          <p className="section-eyebrow">مكتبة السياسات</p>
          <h1>{label}</h1>
          <p className="section-hint">أدخل رمز الدخول الخاص بالإدارة.</p>
          <form onSubmit={unlock}>
            <input
              className="section-pin"
              dir="ltr"
              inputMode="numeric"
              maxLength={5}
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder="•••••"
              aria-label="رمز الدخول"
            />
            {error ? <p className="inline-error">{error}</p> : null}
            <button className="primary-button full" disabled={checking}>
              {checking ? "جاري التحقق..." : "عرض السياسات"}
            </button>
          </form>
        </section>
        <PoweredBy />
      </main>
    );
  }

  return (
    <main className="section-page">
      <section className="section-shell">
        <header className="section-header">
          <p className="section-eyebrow">مكتبة السياسات المعتمدة</p>
          <h1>{label}</h1>
          <span className="section-count">{policies.length} سياسة</span>
        </header>

        {policies.length > 3 ? (
          <label className="search-box">
            <Search aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث عن سياسة"
            />
          </label>
        ) : null}

        {policies.length === 0 ? (
          <p className="section-empty">
            لا توجد سياسات معتمدة نهائيًا لهذه الإدارة بعد، أو أن الرمز غير صحيح.
          </p>
        ) : (
          <ul className="section-list">
            {visible.map((policy) => (
              <li key={policy.id}>
                <article className="section-item">
                  <span className="section-item-icon">
                    {stampPublicUrl(policy.final_stamp_path) ? (
                      <img
                        src={stampPublicUrl(policy.final_stamp_path) ?? undefined}
                        alt="ختم الاعتماد النهائي"
                        title="ختم الاعتماد النهائي"
                      />
                    ) : (
                      <FileText aria-hidden="true" />
                    )}
                  </span>
                  <div>
                    <strong>{policy.title}</strong>
                    <span dir="ltr" className="section-item-code">
                      {policy.policy_number ?? "—"}
                    </span>
                    <span className="section-item-meta">
                      اعتُمدت نهائيًا {formatDate(policy.final_approved_at)} · المراجعة القادمة{" "}
                      {formatDate(policy.next_review_at)}
                    </span>
                    {approvedPdfPublicUrl(policy.approved_pdf_path) ? (
                      <a
                        className="section-item-view"
                        href={approvedPdfPublicUrl(policy.approved_pdf_path) ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <FileCheck2 aria-hidden="true" />
                        عرض الوثيقة المعتمدة والمختومة
                      </a>
                    ) : null}
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>
      <PoweredBy />
    </main>
  );
}
