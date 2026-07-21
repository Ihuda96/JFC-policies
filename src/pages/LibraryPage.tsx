import {
  Building2,
  ChevronDown,
  ChevronLeft,
  FolderTree,
  Minimize2,
  Pencil,
  RefreshCw,
  Search,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { SetupRequired } from "../components/SetupRequired";
import {
  UNCLASSIFIED_LABEL,
  groupPoliciesByDepartment,
  policyReference,
} from "../lib/departments";
import {
  extractPolicyCodeFromBuffer,
  extractPolicyTextSample,
} from "../lib/documentCode";
import { formatDate } from "../lib/format";
import { downloadPolicyFileBytes, readableWorkflowError, setPolicyReference } from "../lib/policyWorkflow";
import { isSetupError, supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import type { PolicyBundle, PolicyFile } from "../lib/types";

export function LibraryPage() {
  const [policies, setPolicies] = useState<PolicyBundle[]>([]);
  const [query, setQuery] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [scanSample, setScanSample] = useState<{ title: string; text: string } | null>(null);
  const [codeDrafts, setCodeDrafts] = useState<Record<string, string>>({});
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const { profile } = useAuth();
  const toast = useToast();
  const canEditCodes =
    profile?.role === "quality_manager" || profile?.role === "system_admin";

  function startEditing(policy: PolicyBundle) {
    setCodeDrafts((current) => ({
      ...current,
      [policy.id]: current[policy.id] ?? policyReference(policy) ?? "",
    }));
    setEditing((current) => new Set(current).add(policy.id));
  }

  function stopEditing(policyId: string) {
    setEditing((current) => {
      const next = new Set(current);
      next.delete(policyId);
      return next;
    });
  }

  async function saveCardCode(policyId: string) {
    const value = (codeDrafts[policyId] ?? "").trim();
    if (!value || savingCode) {
      return;
    }

    setSavingCode(policyId);
    setScanNotice(null);
    try {
      await setPolicyReference(policyId, value);
      setPolicies((current) =>
        current.map((policy) =>
          policy.id === policyId ? { ...policy, policy_number: value } : policy,
        ),
      );
      setCodeDrafts((current) => {
        const next = { ...current };
        delete next[policyId];
        return next;
      });
      stopEditing(policyId);
      toast.success("تم حفظ رمز السياسة.");
    } catch (err) {
      const message = readableWorkflowError(err);
      setScanNotice(message);
      toast.error(message);
    } finally {
      setSavingCode(null);
    }
  }

  function toggle(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!supabase) {
      return;
    }

    if (!options.silent) {
      setLoading(true);
    }
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
    if (!options.silent) {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Read the full code from the document and save it, organising the library in
  // one pass. `rescanAll` re-reads every policy to correct codes stored earlier.
  async function scanLibrary(rescanAll = false) {
    if (!supabase || scanning) {
      return;
    }

    const targets = rescanAll
      ? policies
      : policies.filter((policy) => !policy.policy_number);
    if (targets.length === 0) {
      setScanNotice("جميع السياسات مصنّفة بالفعل.");
      return;
    }

    setScanning(true);
    setScanNotice(null);
    setScanSample(null);
    setScanProgress({ done: 0, total: targets.length });

    const foundCodes = new Map<string, string>();
    let noCode = 0;
    let openFailed = 0;
    let saveFailed = 0;
    let sample: { title: string; text: string } | null = null;

    for (const policy of targets) {
      try {
        const { data: files } = await supabase
          .from("policy_files")
          .select("bucket_id,storage_path,file_name,file_kind,created_at")
          .eq("policy_id", policy.id)
          .eq("file_kind", "original")
          .order("created_at", { ascending: true })
          .limit(1);

        const file = (files as Pick<
          PolicyFile,
          "bucket_id" | "storage_path" | "file_name"
        >[] | null)?.[0];

        if (!file) {
          openFailed += 1;
        } else {
          const buffer = await downloadPolicyFileBytes(file);
          const code = await extractPolicyCodeFromBuffer(buffer, file.file_name);
          if (!code) {
            noCode += 1;
            if (!sample) {
              const text = await extractPolicyTextSample(buffer, file.file_name);
              if (text) {
                sample = { title: policy.title, text };
              }
            }
          } else {
            foundCodes.set(policy.id, code);
            // Persist so it survives a reload; ignore if the DB function is
            // not installed — the in-memory result still organises the view.
            try {
              await setPolicyReference(policy.id, code);
            } catch {
              saveFailed += 1;
            }
          }
        }
      } catch {
        openFailed += 1;
      }
      setScanProgress((prev) => ({ ...prev, done: prev.done + 1 }));
    }

    // Apply detected codes to the current view so the library reorganises
    // immediately, whether or not the save succeeded.
    if (foundCodes.size > 0) {
      setPolicies((current) =>
        current.map((policy) =>
          foundCodes.has(policy.id)
            ? { ...policy, policy_number: foundCodes.get(policy.id) ?? policy.policy_number }
            : policy,
        ),
      );
    }

    setScanning(false);

    const parts: string[] = [];
    if (foundCodes.size > 0) {
      parts.push(
        rescanAll
          ? `تمت قراءة رمز ${foundCodes.size} سياسة`
          : `تم تصنيف ${foundCodes.size} سياسة`,
      );
    }
    if (noCode > 0) {
      parts.push(`${noCode} بدون رمز واضح داخل الملف`);
    }
    if (openFailed > 0) {
      parts.push(`${openFailed} تعذّر فتح ملفها`);
    }
    let notice = parts.length > 0 ? parts.join(" · ") : "لم يتم العثور على سياسات للفحص.";
    if (saveFailed > 0) {
      notice +=
        " — التصنيف ظاهر الآن لكنه لن يُحفظ بعد إعادة التحميل حتى يتم تفعيل الحفظ في قاعدة البيانات.";
    }
    setScanNotice(notice);
    setScanSample(noCode > 0 ? sample : null);
  }

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

  function collapseAll() {
    const keys = new Set<string>();
    for (const department of visibleDepartments) {
      keys.add(department.key);
    }
    setCollapsed(keys);
  }

  function expandAll() {
    setCollapsed(new Set());
  }

  const everythingCollapsed =
    visibleDepartments.length > 0 &&
    visibleDepartments.every((department) => collapsed.has(department.key));

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

      {policies.length > 0 ? (
        <div className="library-toolbar">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void scanLibrary(false)}
            disabled={scanning}
          >
            <RefreshCw aria-hidden="true" className={scanning ? "spin" : undefined} />
            {scanning
              ? `جاري الفحص… ${scanProgress.done}/${scanProgress.total}`
              : "فحص غير المصنّفة"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void scanLibrary(true)}
            disabled={scanning}
          >
            <RefreshCw aria-hidden="true" className={scanning ? "spin" : undefined} />
            إعادة فحص الكل وتصحيح الرموز
          </button>
          {hasResults ? (
            <button
              type="button"
              className="text-button"
              onClick={everythingCollapsed ? expandAll : collapseAll}
            >
              <Minimize2 aria-hidden="true" />
              {everythingCollapsed ? "توسيع الكل" : "طي الكل"}
            </button>
          ) : null}
          {scanNotice ? <span className="library-scan-notice">{scanNotice}</span> : null}
        </div>
      ) : null}

      {scanSample ? (
        <div className="scan-sample">
          <strong>نموذج من نص ملف لم يُقرأ منه رمز:</strong>
          <span>{scanSample.title}</span>
          <code>{scanSample.text || "(لم يُقرأ أي نص — قد يكون الملف صورة ممسوحة ضوئيًا)"}</code>
        </div>
      ) : null}

      {!hasResults ? (
        <EmptyState title="لا توجد نتائج" body="لا توجد سياسات معتمدة تطابق البحث أو الإدارة المحددة." />
      ) : (
        <div className="library-departments">
          {visibleDepartments.map((department) => {
            const departmentCollapsed = collapsed.has(department.key);
            return (
              <section className="library-department" key={department.key}>
                <button
                  type="button"
                  className="library-department-head"
                  aria-expanded={!departmentCollapsed}
                  onClick={() => toggle(department.key)}
                >
                  <div>
                    {departmentCollapsed ? (
                      <ChevronLeft aria-hidden="true" />
                    ) : (
                      <ChevronDown aria-hidden="true" />
                    )}
                    <Building2 aria-hidden="true" />
                    <h2>{department.label}</h2>
                    {department.code ? <code>{department.code}</code> : null}
                  </div>
                  <span>{department.count} سياسة</span>
                </button>

                {departmentCollapsed
                  ? null
                  : department.sections.map((section) => {
                      const sectionKey = `${department.key}//${section.key}`;
                      const sectionCollapsed = collapsed.has(sectionKey);
                      return (
                        <div className="library-section" key={section.key}>
                          {section.label ? (
                            <button
                              type="button"
                              className="library-section-head"
                              aria-expanded={!sectionCollapsed}
                              onClick={() => toggle(sectionKey)}
                            >
                              {sectionCollapsed ? (
                                <ChevronLeft aria-hidden="true" />
                              ) : (
                                <ChevronDown aria-hidden="true" />
                              )}
                              <FolderTree aria-hidden="true" />
                              {section.label}
                              {section.code ? <code>{section.code}</code> : null}
                              <span>{section.policies.length}</span>
                            </button>
                          ) : null}

                          {sectionCollapsed ? null : (
                            <div className="library-grid">
                              {section.policies.map((policy) => (
                                <article className="library-card" key={policy.id}>
                                  <span>{section.label ?? department.label}</span>
                                  <h4>{policy.policy_metadata?.extracted_title ?? policy.title}</h4>
                                  <p>{policyReference(policy) ?? "بدون رقم"}</p>
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
                                  <div className="card-actions">
                                    <Link
                                      className="secondary-button full"
                                      to={`/app/policies/${policy.id}`}
                                    >
                                      معاينة السياسة
                                    </Link>
                                    {canEditCodes &&
                                    department.key !== UNCLASSIFIED_LABEL &&
                                    !editing.has(policy.id) ? (
                                      <button
                                        type="button"
                                        className="icon-button"
                                        onClick={() => startEditing(policy)}
                                        aria-label="تعديل رمز السياسة"
                                        title="تعديل رمز السياسة"
                                      >
                                        <Pencil aria-hidden="true" />
                                      </button>
                                    ) : null}
                                  </div>
                                  {canEditCodes &&
                                  (department.key === UNCLASSIFIED_LABEL ||
                                    editing.has(policy.id)) ? (
                                    <form
                                      className="card-code-editor"
                                      onSubmit={(event) => {
                                        event.preventDefault();
                                        void saveCardCode(policy.id);
                                      }}
                                    >
                                      <input
                                        value={codeDrafts[policy.id] ?? ""}
                                        onChange={(event) =>
                                          setCodeDrafts((current) => ({
                                            ...current,
                                            [policy.id]: event.target.value,
                                          }))
                                        }
                                        placeholder="أدخل رمز السياسة الصحيح"
                                        dir="ltr"
                                      />
                                      <button
                                        type="submit"
                                        className="primary-button"
                                        disabled={
                                          savingCode === policy.id ||
                                          !(codeDrafts[policy.id] ?? "").trim()
                                        }
                                      >
                                        حفظ
                                      </button>
                                      {editing.has(policy.id) ? (
                                        <button
                                          type="button"
                                          className="secondary-button"
                                          onClick={() => stopEditing(policy.id)}
                                        >
                                          إلغاء
                                        </button>
                                      ) : null}
                                    </form>
                                  ) : null}
                                </article>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
