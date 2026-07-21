import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Download, FileText, Send, Trash2, UploadCloud } from "lucide-react";
import { DocumentPreview } from "../components/DocumentPreview";
import { LoadingState } from "../components/LoadingState";
import { SetupRequired } from "../components/SetupRequired";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { fileSize, formatDate, versionStatusLabels } from "../lib/format";
import {
  approvePolicyVersion,
  archivePolicy,
  downloadPolicyFileBytes,
  readableWorkflowError,
  returnPolicyForRevision,
  setPolicyReference,
  signedFileUrl,
  submitPolicyVersion,
  uploadRevision,
} from "../lib/policyWorkflow";
import { policyReference } from "../lib/departments";
import { extractPolicyCodeFromBuffer } from "../lib/documentCode";
import { isSetupError, supabase } from "../lib/supabase";
import type {
  ApprovalAction,
  PolicyBundle,
  PolicyFile,
  PolicyVersion,
  ReviewComment,
} from "../lib/types";

function sortedVersions(versions: PolicyVersion[] = []) {
  return [...versions].sort((a, b) => b.version_number - a.version_number);
}

export function PolicyDetailPage() {
  const { policyId } = useParams();
  const { profile } = useAuth();
  const [policy, setPolicy] = useState<PolicyBundle | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [actions, setActions] = useState<ApprovalAction[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [revisionFile, setRevisionFile] = useState<File | null>(null);
  const [revisionNote, setRevisionNote] = useState("");
  const [returnComment, setReturnComment] = useState("");
  const [archiveReason, setArchiveReason] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backfillAttempted = useRef<string | null>(null);

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!supabase || !policyId) {
      if (!options.silent) {
        setLoading(false);
      }
      return;
    }

    if (!options.silent) {
      setLoading(true);
    }
    const [policyResult, commentsResult, actionsResult] = await Promise.all([
      supabase
        .from("policies")
        .select(
          "*, policy_versions:policy_versions!policy_versions_policy_id_fkey(*), policy_files:policy_files!policy_files_policy_id_fkey(*), policy_metadata:policy_metadata!policy_metadata_policy_id_fkey(*)",
        )
        .eq("id", policyId)
        .maybeSingle(),
      supabase
        .from("review_comments")
        .select("*")
        .eq("policy_id", policyId)
        .order("created_at", { ascending: false }),
      supabase
        .from("approval_actions")
        .select("*")
        .eq("policy_id", policyId)
        .order("created_at", { ascending: false }),
    ]);

    if (policyResult.error) {
      if (isSetupError(policyResult.error)) {
        setSetupError(policyResult.error.message);
      } else {
        setError(policyResult.error.message);
      }
    } else {
      const nextPolicy = policyResult.data as PolicyBundle | null;
      setPolicy(nextPolicy);
      const latest = sortedVersions(nextPolicy?.policy_versions)[0];
      setSelectedVersionId((current) => current ?? latest?.id ?? null);
    }

    if (!commentsResult.error) {
      setComments((commentsResult.data as ReviewComment[]) ?? []);
    }
    if (!actionsResult.error) {
      setActions((actionsResult.data as ApprovalAction[]) ?? []);
    }
    if (!options.silent) {
      setLoading(false);
    }
  }, [policyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const versions = useMemo(() => sortedVersions(policy?.policy_versions), [policy]);
  const selectedVersion = versions.find((version) => version.id === selectedVersionId) ?? versions[0];
  const selectedVersionFiles = useMemo<PolicyFile[]>(() => {
    if (!policy || !selectedVersion) {
      return [];
    }

    return [...(policy.policy_files ?? [])]
      .filter((file) => file.version_id === selectedVersion.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [policy, selectedVersion]);
  const originalFile =
    selectedVersionFiles.find((file) => file.file_kind === "original") ?? null;
  const selectedFile = originalFile;

  // If the full code was never stored, read it from the document and save it
  // so the policy classifies automatically and shows its full number.
  useEffect(() => {
    const original =
      policy?.policy_files?.find((file) => file.file_kind === "original") ?? null;
    if (!policy || policy.policy_number || !original) {
      return;
    }
    if (backfillAttempted.current === policy.id) {
      return;
    }
    backfillAttempted.current = policy.id;

    let cancelled = false;
    void (async () => {
      try {
        const buffer = await downloadPolicyFileBytes(original);
        const code = await extractPolicyCodeFromBuffer(buffer, original.file_name);
        if (code && !cancelled) {
          await setPolicyReference(policy.id, code);
          if (!cancelled) {
            await load({ silent: true });
          }
        }
      } catch {
        // Best-effort; ignore failures.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [policy, load]);

  async function submitLatest() {
    if (!policy || !selectedVersion) {
      return;
    }

    setActionLoading(true);
    setError(null);
    try {
      await submitPolicyVersion(policy.id, selectedVersion.id, revisionNote);
      await load();
    } catch (err) {
      setError(readableWorkflowError(err));
    } finally {
      setActionLoading(false);
    }
  }

  async function approve() {
    if (!policy || !selectedVersion) {
      return;
    }

    setActionLoading(true);
    setError(null);
    try {
      await approvePolicyVersion(policy.id, selectedVersion.id);
      await load();
    } catch (err) {
      setError(readableWorkflowError(err));
    } finally {
      setActionLoading(false);
    }
  }

  async function returnForRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy || !selectedVersion) {
      return;
    }

    setActionLoading(true);
    setError(null);
    try {
      await returnPolicyForRevision({
        policyId: policy.id,
        versionId: selectedVersion.id,
        comment: returnComment,
      });
      setReturnComment("");
      await load();
    } catch (err) {
      setError(readableWorkflowError(err));
    } finally {
      setActionLoading(false);
    }
  }

  async function submitRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy || !revisionFile) {
      return;
    }

    setActionLoading(true);
    setError(null);
    try {
      const revision = await uploadRevision({
        policy,
        file: revisionFile,
        note: revisionNote,
      });
      await submitPolicyVersion(policy.id, revision.versionId, revisionNote);
      setRevisionFile(null);
      setRevisionNote("");
      setSelectedVersionId(revision.versionId);
      await load();
    } catch (err) {
      setError(readableWorkflowError(err));
    } finally {
      setActionLoading(false);
    }
  }

  function onRevisionFile(event: ChangeEvent<HTMLInputElement>) {
    setRevisionFile(event.target.files?.[0] ?? null);
  }

  async function openVersionFile(file: PolicyFile, action: "download" | "print") {
    setError(null);
    try {
      const url = await signedFileUrl(file, action);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(readableWorkflowError(err));
    }
  }

  async function savePolicyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy) {
      return;
    }

    const value = codeInput.trim();
    if (!value) {
      return;
    }

    setActionLoading(true);
    setError(null);
    try {
      await setPolicyReference(policy.id, value);
      setCodeInput("");
      await load();
    } catch (err) {
      setError(readableWorkflowError(err));
    } finally {
      setActionLoading(false);
    }
  }

  async function archiveCurrentPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy) {
      return;
    }

    const confirmed = window.confirm(
      policy.status === "approved"
        ? "سيتم حذف السياسة المعتمدة من المكتبة ونقلها إلى الأرشيف مع حفظ سجل التدقيق. هل تريد المتابعة؟"
        : "سيتم حذف السياسة من القوائم ونقلها إلى الأرشيف مع حفظ سجل التدقيق. هل تريد المتابعة؟",
    );

    if (!confirmed) {
      return;
    }

    setActionLoading(true);
    setError(null);
    try {
      await archivePolicy(policy.id, archiveReason);
      setArchiveReason("");
      await load();
    } catch (err) {
      setError(readableWorkflowError(err));
    } finally {
      setActionLoading(false);
    }
  }

  if (setupError) {
    return <SetupRequired message={setupError} />;
  }

  if (loading) {
    return <LoadingState />;
  }

  if (!policy) {
    return <SetupRequired message={error ?? "لم يتم العثور على السياسة أو لا تملك صلاحية الوصول لها."} />;
  }

  const canManagerAct =
    profile?.role === "quality_manager" &&
    ["pending_approval", "resubmitted"].includes(policy.status);
  const canOwnerRevise =
    policy.owner_id === profile?.id &&
    ["draft", "returned_for_revision"].includes(policy.status);
  const canArchive =
    policy.status !== "archived" &&
    (profile?.role === "quality_manager" ||
      (policy.owner_id === profile?.id && ["draft", "returned_for_revision"].includes(policy.status)));
  const canSetCode =
    !policy.policy_number &&
    (profile?.role === "quality_manager" ||
      profile?.role === "system_admin" ||
      policy.owner_id === profile?.id);
  const originalIsPdf = Boolean(originalFile?.file_name.toLowerCase().endsWith(".pdf"));

  return (
    <div className="policy-detail">
      <section className="policy-header">
        <div>
          <StatusBadge status={policy.status} />
          <h1>{policy.title}</h1>
          <p>
            رقم السياسة: {policyReference(policy) ?? "لم يستخرج بعد"} · آخر تحديث{" "}
            {formatDate(policy.updated_at)}
          </p>
        </div>
        <div className="version-tabs" role="tablist" aria-label="إصدارات السياسة">
          {versions.map((version) => (
            <button
              key={version.id}
              className={version.id === selectedVersion?.id ? "active" : ""}
              onClick={() => setSelectedVersionId(version.id)}
            >
              نسخة {version.version_number}
              <span>{versionStatusLabels[version.status]}</span>
            </button>
          ))}
        </div>
      </section>

      {error ? <p className="inline-error">{error}</p> : null}

      <section className="review-layout">
        <DocumentPreview file={selectedFile} />
        <aside className="review-panel">
          {canSetCode ? (
            <form className="info-card" onSubmit={savePolicyCode}>
              <h2>رمز السياسة</h2>
              <p>
                لم يُقرأ رمز هذه السياسة من الملف تلقائيًا. أدخله يدويًا ليظهر في
                رقم السياسة وتُصنّف تحت إدارتها (مثال: JFHC-HRD-JTA-APP-PP-02).
              </p>
              <input
                value={codeInput}
                onChange={(event) => setCodeInput(event.target.value)}
                placeholder="JFHC-HRD-JTA-APP-PP-02"
                dir="ltr"
              />
              <button className="primary-button full" disabled={actionLoading || !codeInput.trim()}>
                حفظ الرمز
              </button>
            </form>
          ) : null}

          <div className="info-card">
            <h2>بيانات الطلب</h2>
            <dl>
              <div>
                <dt>النسخة المحددة</dt>
                <dd>{selectedVersion?.version_number ?? "-"}</dd>
              </div>
              <div>
                <dt>تاريخ الإرسال</dt>
                <dd>{formatDate(selectedVersion?.submitted_at)}</dd>
              </div>
              <div>
                <dt>تاريخ الاعتماد</dt>
                <dd>{formatDate(policy.approved_at)}</dd>
              </div>
            </dl>
          </div>

          <div className="info-card">
            <h2>ملفات النسخة</h2>
            {originalFile ? (
              <article className="file-action-row">
                <div>
                  <FileText aria-hidden="true" />
                  <span>
                    <strong>{originalIsPdf ? "PDF الأصلي" : "Word الأصلي"}</strong>
                    {originalFile.file_name} · {fileSize(originalFile.file_size)}
                  </span>
                </div>
                <button onClick={() => void openVersionFile(originalFile, "download")}>
                  <Download aria-hidden="true" />
                  {originalIsPdf ? "تنزيل PDF" : "تنزيل Word"}
                </button>
              </article>
            ) : null}
          </div>

          {canOwnerRevise ? (
            <form className="info-card" onSubmit={submitRevision}>
              <h2>رفع نسخة معدلة</h2>
              <textarea
                placeholder="ملخص التعديل أو رد على الملاحظات"
                value={revisionNote}
                onChange={(event) => setRevisionNote(event.target.value)}
              />
              <label className="file-line">
                <UploadCloud aria-hidden="true" />
                <span>{revisionFile ? revisionFile.name : "اختر ملف النسخة المعدلة"}</span>
                <input type="file" accept=".pdf,.docx" onChange={onRevisionFile} />
              </label>
              <button
                className="primary-button full"
                disabled={actionLoading || !revisionFile}
              >
                <Send aria-hidden="true" />
                رفع وإرسال
              </button>
              {policy.status === "draft" && selectedVersion ? (
                <button
                  type="button"
                  className="secondary-button full"
                  onClick={() => void submitLatest()}
                  disabled={actionLoading}
                >
                  إرسال النسخة الحالية
                </button>
              ) : null}
            </form>
          ) : null}

          {canManagerAct ? (
            <div className="info-card">
              <h2>قرار مدير الجودة</h2>
              <button className="primary-button full" onClick={() => void approve()} disabled={actionLoading}>
                <CheckCircle2 aria-hidden="true" />
                اعتماد ونشر
              </button>
              <form onSubmit={returnForRevision}>
                <textarea
                  required
                  placeholder="ملاحظات الإعادة للتعديل"
                  value={returnComment}
                  onChange={(event) => setReturnComment(event.target.value)}
                />
                <button className="secondary-button full" disabled={actionLoading}>
                  إعادة للتعديل
                </button>
              </form>
            </div>
          ) : null}

          {canArchive ? (
            <form className="info-card danger-card" onSubmit={archiveCurrentPolicy}>
              <h2>حذف السياسة</h2>
              <p>
                الحذف ينقل السياسة إلى الأرشيف ويخفيها من القوائم والمكتبة مع إبقاء سجل التدقيق والملفات محفوظة.
              </p>
              <textarea
                placeholder="سبب الحذف (اختياري)"
                value={archiveReason}
                onChange={(event) => setArchiveReason(event.target.value)}
              />
              <button className="danger-button full" disabled={actionLoading}>
                <Trash2 aria-hidden="true" />
                حذف السياسة
              </button>
            </form>
          ) : null}

          <div className="info-card">
            <h2>الملاحظات</h2>
            {comments.length === 0 ? <p>لا توجد ملاحظات مسجلة.</p> : null}
            {comments.map((comment) => (
              <article className="timeline-item" key={comment.id}>
                <strong>{comment.page_number ? `صفحة ${comment.page_number}` : "ملاحظة عامة"}</strong>
                <p>{comment.comment_text}</p>
                <span>{formatDate(comment.created_at)}</span>
              </article>
            ))}
          </div>

          <div className="info-card">
            <h2>سجل السياسة</h2>
            {actions.length === 0 ? <p>لا توجد إجراءات بعد.</p> : null}
            {actions.map((action) => (
              <article className="timeline-item" key={action.id}>
                <strong>{action.action}</strong>
                {action.comment ? <p>{action.comment}</p> : null}
                <span>{formatDate(action.created_at)}</span>
              </article>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}
