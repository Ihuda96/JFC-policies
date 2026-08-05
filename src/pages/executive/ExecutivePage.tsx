import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { RotateCcw, Stamp } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { classifyPolicy, policyReference } from "../../lib/departments";
import { formatDate, initials } from "../../lib/format";
import { isExecutive } from "../../lib/permissions";
import {
  downloadPolicyFileBytes,
  readableWorkflowError,
  signedFileUrl,
} from "../../lib/policyWorkflow";
import { stampPublicUrl, toPngBlob } from "../../lib/stamp";
import { errorMessage, supabase } from "../../lib/supabase";
import { useConfirm } from "../../components/ConfirmDialog";
import { PoweredBy } from "../../components/PoweredBy";
import { useToast } from "../../components/Toast";
import { ExecutiveSetPassword } from "./ExecutiveSetPassword";
import type { PolicyBundle, PolicyFile } from "../../lib/types";

const STAMP_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const STAMP_MAX_BYTES = 2 * 1024 * 1024;

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "صباح الخير";
  if (hour < 17) return "طاب يومك";
  return "مساء الخير";
}

const monthFmt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { month: "short" });
const todayFmt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function pct(count: number, max: number) {
  return max > 0 ? Math.round((count / max) * 100) : 0;
}

type Tone = "danger" | "warning" | "info" | "success";

function reviewUrgency(days: number): { label: string; tone: Tone } {
  if (days < 0) return { label: `متأخرة ${Math.abs(days)} يوم`, tone: "danger" };
  if (days === 0) return { label: "مستحقة اليوم", tone: "danger" };
  if (days <= 30) return { label: `خلال ${days} يوم`, tone: "warning" };
  return { label: `خلال ${days} يوم`, tone: "info" };
}

export function ExecutivePage() {
  const { profile, loading: authLoading, signOut, refreshProfile } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [policies, setPolicies] = useState<PolicyBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [queueOpen, setQueueOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [sealing, setSealing] = useState(false);
  const [uploadingStamp, setUploadingStamp] = useState(false);
  const stampInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("policies")
      .select(
        "*, policy_files:policy_files!policy_files_policy_id_fkey(*), policy_metadata:policy_metadata!policy_metadata_policy_id_fkey(*)",
      )
      .eq("status", "approved")
      .order("approved_at", { ascending: false });

    if (!error) {
      setPolicies((data as PolicyBundle[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = useMemo(
    () => policies.filter((policy) => !policy.final_approved_at),
    [policies],
  );
  const finalised = useMemo(
    () => policies.filter((policy) => policy.final_approved_at),
    [policies],
  );
  const completion = policies.length
    ? Math.round((finalised.length / policies.length) * 100)
    : 0;

  const visiblePending = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return pending;
    return pending.filter((policy) =>
      [policy.title, policy.policy_number, policy.owner_department]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [pending, query]);

  const recentFinal = useMemo(() => finalised.slice(0, 8), [finalised]);

  const departmentRows = useMemo(() => {
    const counts = new Map<string, { approved: number; pending: number }>();
    for (const policy of policies) {
      const label = classifyPolicy(policy).departmentLabel;
      const entry = counts.get(label) ?? { approved: 0, pending: 0 };
      if (policy.final_approved_at) entry.approved += 1;
      else entry.pending += 1;
      counts.set(label, entry);
    }
    return [...counts.entries()]
      .map(([label, { approved, pending }]) => ({ label, approved, pending, total: approved + pending }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [policies]);

  const avgApprovalDays = useMemo(() => {
    const durations: number[] = [];
    for (const policy of finalised) {
      if (!policy.submitted_at || !policy.final_approved_at) continue;
      const start = new Date(policy.submitted_at).getTime();
      const end = new Date(policy.final_approved_at).getTime();
      if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
      durations.push((end - start) / (1000 * 60 * 60 * 24));
    }
    if (durations.length === 0) return null;
    return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  }, [finalised]);

  const upcomingReviews = useMemo(() => {
    const now = Date.now();
    return policies
      .map((policy) => {
        const reviewDate = policy.policy_metadata?.review_date ?? policy.next_review_at;
        if (!reviewDate) return null;
        const parsed = new Date(reviewDate);
        if (Number.isNaN(parsed.getTime())) return null;
        const days = Math.ceil((parsed.getTime() - now) / (1000 * 60 * 60 * 24));
        return { policy, days };
      })
      .filter((item): item is { policy: PolicyBundle; days: number } => item !== null && item.days <= 90)
      .sort((a, b) => a.days - b.days)
      .slice(0, 8);
  }, [policies]);

  const recommendations = useMemo(() => {
    const items: { id: string; tone: Tone; text: string }[] = [];

    if (pending.length > 0) {
      const oldest = [...pending].sort((a, b) => {
        const aTime = new Date(a.submitted_at ?? a.created_at).getTime();
        const bTime = new Date(b.submitted_at ?? b.created_at).getTime();
        return aTime - bTime;
      })[0];
      const started = oldest.submitted_at ?? oldest.created_at;
      const days = Math.max(
        0,
        Math.floor((Date.now() - new Date(started).getTime()) / (1000 * 60 * 60 * 24)),
      );
      if (days >= 3) {
        items.push({
          id: "oldest",
          tone: days >= 14 ? "danger" : "warning",
          text: `أقدم سياسة بانتظار الاعتماد "${oldest.title}" منذ ${days} يومًا — يُنصح بمراجعتها أولاً.`,
        });
      }
    }

    const busiestDept = [...departmentRows].filter((row) => row.pending > 0).sort((a, b) => b.pending - a.pending)[0];
    if (busiestDept && busiestDept.pending > 1) {
      items.push({
        id: "department",
        tone: "warning",
        text: `"${busiestDept.label}" لديها ${busiestDept.pending} سياسة بانتظار الاعتماد، الأكثر بين الإدارات.`,
      });
    }

    const overdue = upcomingReviews.filter((item) => item.days < 0).length;
    if (overdue > 0) {
      items.push({
        id: "overdue",
        tone: "danger",
        text: `${overdue} سياسة تجاوزت تاريخ مراجعتها المحدد — يُنصح بجدولتها في أقرب وقت.`,
      });
    }

    const dueSoon = upcomingReviews.filter((item) => item.days >= 0 && item.days <= 30).length;
    if (dueSoon > 0) {
      items.push({
        id: "due-soon",
        tone: "info",
        text: `${dueSoon} سياسة مستحقة المراجعة خلال ٣٠ يومًا القادمة.`,
      });
    }

    if (items.length === 0) {
      items.push({
        id: "clear",
        tone: "success",
        text: "لا توجد توصيات عاجلة حاليًا — جميع السياسات ضمن الجدول المتوقع.",
      });
    }

    return items.slice(0, 4);
  }, [pending, departmentRows, upcomingReviews]);

  const trend = useMemo(() => {
    const months: { label: string; count: number }[] = [];
    const index = new Map<string, number>();
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date();
      d.setMonth(d.getMonth() - i, 1);
      index.set(`${d.getFullYear()}-${d.getMonth()}`, months.length);
      months.push({ label: monthFmt.format(d), count: 0 });
    }
    for (const policy of finalised) {
      if (!policy.final_approved_at) continue;
      const d = new Date(policy.final_approved_at);
      if (Number.isNaN(d.getTime())) continue;
      const idx = index.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (idx !== undefined) months[idx].count += 1;
    }
    const max = Math.max(1, ...months.map((m) => m.count));
    return months.map((m) => ({ ...m, pct: pct(m.count, max) }));
  }, [finalised]);

  async function uploadStamp(file: File) {
    if (!supabase || !profile) return;

    if (!STAMP_TYPES.has(file.type)) {
      toast.error("صيغ الختم المسموحة: PNG أو JPEG أو WebP.");
      return;
    }
    if (file.size > STAMP_MAX_BYTES) {
      toast.error("حجم صورة الختم يجب ألا يتجاوز 2 ميجابايت.");
      return;
    }

    setUploadingStamp(true);
    try {
      // Always store as a clean PNG regardless of what was picked, so it can
      // be embedded directly into a policy PDF later with no format handling.
      const pngBlob = await toPngBlob(file);
      const path = `${profile.id}/stamp-${Date.now()}.png`;

      const { error: uploadError } = await supabase.storage
        .from("ceo-stamps")
        .upload(path, pngBlob, { contentType: "image/png", upsert: false });
      if (uploadError) throw uploadError;

      const { error: rpcError } = await supabase.rpc("set_ceo_stamp", {
        p_storage_path: path,
      });
      if (rpcError) throw rpcError;

      await refreshProfile();
      toast.success("تم حفظ ختم الاعتماد. سيُستخدم تلقائيًا في كل اعتماد نهائي قادم.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploadingStamp(false);
    }
  }

  // Burns the CEO's e-stamp onto the policy's original PDF and registers
  // the result as its approved_pdf file. Best-effort: the policy is still
  // validly finally-approved even if this fails, so failures are surfaced
  // but never block or undo the approval itself.
  async function stampPolicyDocument(policy: PolicyBundle) {
    if (!supabase || !profile?.stamp_path) {
      return true;
    }

    const versionId = policy.approved_version_id;
    const original = (policy.policy_files ?? []).find(
      (item) => item.file_kind === "original" && item.version_id === versionId,
    );
    if (!original || !original.content_type.toLowerCase().includes("pdf")) {
      // Only PDF originals can be stamped in place; DOCX has no in-browser
      // path for this without converting it first.
      return true;
    }

    try {
      const stampUrl = stampPublicUrl(profile.stamp_path);
      if (!stampUrl) return true;

      const [pdfBytes, stampBytes] = await Promise.all([
        downloadPolicyFileBytes(original),
        fetch(stampUrl).then((response) => response.arrayBuffer()),
      ]);

      // Loaded on demand — pdf-lib is only ever needed at the moment of a
      // CEO approval, not on every visitor's initial page load.
      const { embedStampInPdf } = await import("../../lib/stampPdf");
      const stampedBytes = await embedStampInPdf(pdfBytes, stampBytes);
      // A unique filename per attempt — never a fixed, reused path — so
      // this upload can never collide with anything already sitting in the
      // bucket (including any orphaned object left behind by an earlier
      // failed attempt, which a delete-then-reinsert fallback couldn't
      // reliably clean up: an orphan with no matching policy_files row is
      // invisible to this account's own SELECT policy, so Storage's remove()
      // silently no-ops on it instead of actually deleting it). Any
      // previously-tracked stamped file for this policy is best-effort
      // cleaned up separately, using its real recorded path.
      const path = `${profile.id}/${policy.id}/${versionId}/approved-stamped-${Date.now()}.pdf`;
      const stampedBlob = new Blob([Uint8Array.from(stampedBytes)], { type: "application/pdf" });

      const previousStampedFiles = (policy.policy_files ?? []).filter(
        (item) => item.file_kind === "approved_pdf",
      );
      if (previousStampedFiles.length > 0) {
        await supabase.storage
          .from("policy-approved")
          .remove(previousStampedFiles.map((item) => item.storage_path));
      }

      let { error: uploadError } = await supabase.storage
        .from("policy-approved")
        .upload(path, stampedBlob, { contentType: "application/pdf", upsert: false });

      // Storage requests carry their own snapshot of the session token,
      // separate from the RPC call that just ran moments earlier. If that
      // snapshot went stale mid-flow (this whole function spends a few
      // seconds downloading and re-encoding the PDF first), the upload can
      // be rejected by RLS even though the user is genuinely still signed
      // in. One retry after an explicit refresh clears that up without
      // bothering the CEO with a transient failure.
      if (uploadError && /row-level security/i.test(uploadError.message)) {
        await supabase.auth.refreshSession();
        ({ error: uploadError } = await supabase.storage
          .from("policy-approved")
          .upload(path, stampedBlob, { contentType: "application/pdf", upsert: false }));
      }

      if (uploadError) {
        // ⁦/⁩ (LRI/PDI) force the LTR path and uid to render in
        // their own order inside this RTL sentence — without them the
        // browser's bidi algorithm reorders/wraps them into an unreadable
        // scramble mid-string.
        throw new Error(
          `تعذّر رفع الملف المختوم (المسار: ⁦${path}⁩ — معرّف المستخدم الحالي: ⁦${profile.id}⁩): ${errorMessage(uploadError)}`,
        );
      }

      const fileName = `${original.file_name.replace(/\.[^.]+$/, "")}-معتمد.pdf`;
      const { error: rpcError } = await supabase.rpc("record_approved_pdf", {
        p_policy_id: policy.id,
        p_version_id: versionId,
        p_storage_path: path,
        p_file_name: fileName,
        p_file_size: stampedBytes.byteLength,
      });
      if (rpcError) {
        throw new Error(`تعذّر تسجيل الملف المختوم: ${errorMessage(rpcError)}`);
      }

      return true;
    } catch (err) {
      toast.error(`تعذّر ختم نسخة PDF لسياسة "${policy.title}": ${errorMessage(err)}`);
      return false;
    }
  }

  async function approveAll() {
    if (!supabase || pending.length === 0) return;

    const confirmed = await confirm({
      title: "اعتماد التقارير المعلّقة",
      body: `سيُعتمد ${pending.length} من السياسات ويُتاح نشرها. لا يمكن التراجع عن هذا الإجراء دون مراجعة.`,
      confirmLabel: "اعتماد",
    });
    if (!confirmed) return;

    const batch = pending;
    setApprovingAll(true);
    try {
      const { error } = await supabase.rpc("ceo_final_approve_all");
      if (error) throw error;
      setSealing(true);
      window.setTimeout(() => setSealing(false), 1500);

      if (profile?.stamp_path) {
        for (const policy of batch) {
          await stampPolicyDocument(policy);
        }
      }

      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setApprovingAll(false);
    }
  }

  async function approveOne(policy: PolicyBundle) {
    if (!supabase) return;
    setBusy(policy.id);
    try {
      const { error } = await supabase.rpc("ceo_final_approve", { p_policy_id: policy.id });
      if (error) throw error;
      await stampPolicyDocument(policy);
      toast.success("تم اعتماد السياسة نهائيًا.");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function unapprovePolicy(policy: PolicyBundle) {
    if (!supabase) return;

    const confirmed = await confirm({
      title: "إلغاء الاعتماد النهائي",
      body: `ستعود سياسة "${policy.title}" إلى قائمة الانتظار للاعتماد النهائي، وتُحذف نسختها المختومة نهائيًا (بما فيها ما يظهر عبر رمز الباركود). لن تُرسل إلى صاحبها للمراجعة.`,
      confirmLabel: "إلغاء الاعتماد",
    });
    if (!confirmed) return;

    setBusy(policy.id);
    try {
      // Supabase refuses direct SQL deletes on storage.objects ("use the
      // Storage API instead") so the RPC can't remove the stamped PDF's
      // underlying file itself — only its policy_files metadata row. Do
      // the actual storage deletion here, client-side, through the Storage
      // API (allowed for the CEO's own uid-prefixed folder), before the
      // RPC clears the policy's approval fields and metadata.
      const stampedFiles = (policy.policy_files ?? []).filter(
        (item: PolicyFile) => item.file_kind === "approved_pdf",
      );
      if (stampedFiles.length > 0) {
        const { error: removeError } = await supabase.storage
          .from("policy-approved")
          .remove(stampedFiles.map((item) => item.storage_path));
        if (removeError) throw removeError;
      }

      const { error } = await supabase.rpc("ceo_unapprove_policy", { p_policy_id: policy.id });
      if (error) throw error;
      toast.success("أُلغي الاعتماد النهائي، وحُذفت نسختها المختومة، وعادت السياسة لقائمة الانتظار.");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function returnWithNote(policy: PolicyBundle) {
    if (!supabase) return;
    if (note.trim().length === 0) {
      toast.error("اكتب ملاحظة قبل المتابعة.");
      return;
    }
    setBusy(policy.id);
    try {
      const { error } = await supabase.rpc("ceo_return_policy", {
        p_policy_id: policy.id,
        p_comment: note.trim(),
      });
      if (error) throw error;
      toast.success("أُعيدت السياسة مع الملاحظات.");
      setNote("");
      setOpenId(null);
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function openDocument(policy: PolicyBundle) {
    const files = policy.policy_files ?? [];
    const file =
      files.find((item: PolicyFile) => item.file_kind === "approved_pdf") ??
      files.find((item: PolicyFile) => item.file_kind === "original");
    if (!file) {
      toast.error("لا يوجد ملف مرفق.");
      return;
    }
    try {
      const url = await signedFileUrl(file, "preview");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(readableWorkflowError(err));
    }
  }

  if (authLoading) {
    return (
      <main className="exec-portal exec-portal-loading">
        <span className="spinner" aria-label="جاري التحميل" />
      </main>
    );
  }

  if (!profile) return <Navigate to="/executive/login" replace />;
  if (!isExecutive(profile)) return <Navigate to="/app" replace />;
  if (profile.must_change_password) return <ExecutiveSetPassword />;

  const firstName = (profile.full_name ?? "").split(" ")[0];

  return (
    <div className="exec-portal exec-dashboard">
      {sealing ? (
        <div className="seal-stage" role="status" aria-live="polite">
          <div className="seal-stage-mark" aria-hidden="true">
            <img src="/brand/jfc-emblem.png" alt="" />
          </div>
          <p>تم الاعتماد</p>
        </div>
      ) : null}

      <header className="topbar">
        <div className="wrap topbar-inner">
          <div className="lockup">
            <div className="seal" aria-hidden="true">
              <img src="/brand/jfc-emblem.png" alt="" />
            </div>
            <div className="lockup-text">
              <span className="primary">
                تجمع جدة الصحي الأول
                <span className="org-code">JFHC</span>
              </span>
              <span className="secondary">مكتب الرئيس التنفيذي</span>
            </div>
          </div>
          <div className="topbar-actions">
            <input
              ref={stampInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void uploadStamp(file);
              }}
            />
            <button
              type="button"
              className="stamp-trigger"
              disabled={uploadingStamp}
              onClick={() => stampInputRef.current?.click()}
              title={profile.stamp_path ? "تغيير ختم الاعتماد" : "رفع ختم الاعتماد"}
              aria-label={profile.stamp_path ? "تغيير ختم الاعتماد" : "رفع ختم الاعتماد"}
            >
              {profile.stamp_path ? (
                <img src={stampPublicUrl(profile.stamp_path) ?? undefined} alt="" />
              ) : (
                <Stamp aria-hidden="true" />
              )}
            </button>
            <div className="profile-chip">
              <span className="profile-avatar" aria-hidden="true">
                {initials(profile.full_name)}
              </span>
              <span className="profile-text">
                <span className="primary">{profile.full_name ?? "الرئيس التنفيذي"}</span>
                <span className="secondary">الرئيس التنفيذي</span>
              </span>
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => void signOut()}>
              خروج
            </button>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="wrap">
          <div className="hero-inner">
            <span className="eyebrow">
              {greeting()}
              {firstName ? `، ${firstName}` : ""} · {todayFmt.format(new Date())}
            </span>
            <h1 className="display-l">{pending.length} سياسة بانتظار الاعتماد</h1>
            <p className="lede">راجع الوثيقة وسياقها الكامل، ثم اعتمد.</p>
            <div className="orbit-divider" aria-hidden="true">
              <span className="tick" />
              <span className="medallion" />
              <span className="tick" />
            </div>
            {pending.length > 0 ? (
              <button
                type="button"
                className="btn btn-primary hero-cta"
                disabled={approvingAll}
                onClick={() => void approveAll()}
              >
                {approvingAll ? "جاري الاعتماد..." : `اعتماد الكل (${pending.length})`}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="grid grid-4">
            <div className="kpi">
              <span className="eyebrow">بانتظار الاعتماد</span>
              <div className="value accent">{pending.length}</div>
            </div>
            <div className="kpi">
              <span className="eyebrow">مُعتمد</span>
              <div className="value">{finalised.length}</div>
            </div>
            <div className="kpi">
              <span className="eyebrow">نسبة الإنجاز</span>
              <div className="value">{completion}٪</div>
            </div>
            <div className="kpi">
              <span className="eyebrow">متوسط زمن الاعتماد</span>
              <div className="value">{avgApprovalDays !== null ? `${avgApprovalDays} يوم` : "—"}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">التوصيات</span>
            <h2>ما يستحق انتباهك الآن</h2>
            <div className="orbit-divider" aria-hidden="true">
              <span className="tick" />
              <span className="medallion" />
              <span className="tick" />
            </div>
          </div>
          <div className="rec-list">
            {recommendations.map((item) => (
              <div className="rec-item" key={item.id}>
                <span className={`dot ${item.tone}`} aria-hidden="true" />
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">بانتظار الاعتماد</span>
            <h2>السياسات</h2>
            <div className="orbit-divider" aria-hidden="true">
              <span className="tick" />
              <span className="medallion" />
              <span className="tick" />
            </div>
          </div>

          {loading ? (
            <p className="muted">جاري التحميل...</p>
          ) : pending.length === 0 ? (
            <div className="empty">
              <div className="mark" aria-hidden="true">
                ✓
              </div>
              <h3>لا شيء بانتظار الاعتماد</h3>
              <p>جميع السياسات معتمدة.</p>
            </div>
          ) : (
            <article className={`card queue-card${queueOpen ? " is-open" : ""}`}>
              <button
                type="button"
                className="queue-card-toggle"
                aria-expanded={queueOpen}
                onClick={() => setQueueOpen((current) => !current)}
              >
                <span className="queue-card-summary">
                  <span className="pill warning">قيد المراجعة</span>
                  <h3>{pending.length} سياسة بانتظار الاعتماد</h3>
                  <span className="caption">اضغط لعرض القائمة ومراجعة كل سياسة</span>
                </span>
                <span className="chevron" aria-hidden="true" />
              </button>

              {queueOpen ? (
                <div className="queue-card-body">
                  {pending.length > 3 ? (
                    <div className="field" style={{ marginBlockEnd: "var(--space-5)", maxInlineSize: "360px" }}>
                      <input
                        className="input"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="ابحث عن سياسة"
                      />
                    </div>
                  ) : null}

                  {visiblePending.length === 0 ? (
                    <p className="muted">لا توجد نتائج. جرّب كلمات بحث مختلفة.</p>
                  ) : (
                    <div className="grid">
                      {visiblePending.map((policy) => {
                        const classification = classifyPolicy(policy);
                        const isOpen = openId === policy.id;
                        const isExpanded = expandedId === policy.id;
                        return (
                          <article
                            className={`card queue-card${isExpanded ? " is-open bloom-corner" : ""}`}
                            key={policy.id}
                          >
                            <button
                              type="button"
                              className="queue-card-toggle"
                              aria-expanded={isExpanded}
                              onClick={() => setExpandedId(isExpanded ? null : policy.id)}
                            >
                              <span className="queue-card-summary">
                                <span className="pill warning">قيد المراجعة</span>
                                <h3>{policy.title}</h3>
                                <span className="caption code" dir="ltr" style={{ textAlign: "start" }}>
                                  {policyReference(policy) ?? "—"}
                                </span>
                              </span>
                              <span className="caption">{classification.departmentLabel}</span>
                              <span className="chevron" aria-hidden="true" />
                            </button>

                            {isExpanded ? (
                              <div className="queue-card-body">
                                <div className="meta-grid">
                                  <div>
                                    <p className="caption">تاريخ الإصدار</p>
                                    <p>{formatDate(policy.policy_metadata?.issue_date ?? policy.approved_at)}</p>
                                  </div>
                                  <div>
                                    <p className="caption">تاريخ المراجعة</p>
                                    <p>{formatDate(policy.policy_metadata?.review_date ?? policy.next_review_at)}</p>
                                  </div>
                                </div>

                                <div className="demo-row" style={{ marginBlockStart: "var(--space-5)" }}>
                                  <button type="button" className="btn btn-secondary" onClick={() => void openDocument(policy)}>
                                    عرض الوثيقة
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-primary"
                                    disabled={busy === policy.id}
                                    onClick={() => void approveOne(policy)}
                                  >
                                    {busy === policy.id ? "جاري الاعتماد..." : "اعتماد هذه السياسة"}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-quiet"
                                    onClick={() => {
                                      setOpenId(isOpen ? null : policy.id);
                                      setNote("");
                                    }}
                                  >
                                    {isOpen ? "إلغاء" : "إعادة مع ملاحظات"}
                                  </button>
                                </div>

                                {isOpen ? (
                                  <div style={{ marginBlockStart: "var(--space-5)" }}>
                                    <div className="field">
                                      <textarea
                                        className="textarea"
                                        value={note}
                                        onChange={(event) => setNote(event.target.value)}
                                        placeholder="سبب الإعادة"
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      disabled={busy === policy.id}
                                      onClick={() => void returnWithNote(policy)}
                                    >
                                      تأكيد الإعادة
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}
            </article>
          )}
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">المراجعات</span>
            <h2>مراجعات مستحقة قريباً</h2>
            <div className="orbit-divider" aria-hidden="true">
              <span className="tick" />
              <span className="medallion" />
              <span className="tick" />
            </div>
          </div>

          {upcomingReviews.length === 0 ? (
            <div className="empty">
              <div className="mark" aria-hidden="true">
                ✓
              </div>
              <h3>لا توجد مراجعات مستحقة خلال ٩٠ يوماً</h3>
              <p>تُقرأ هذه المواعيد من تاريخ المراجعة في ترويسة كل سياسة.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>السياسة</th>
                    <th>الرمز</th>
                    <th>الإدارة</th>
                    <th>تاريخ المراجعة</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingReviews.map(({ policy, days }) => {
                    const classification = classifyPolicy(policy);
                    const urgency = reviewUrgency(days);
                    return (
                      <tr key={policy.id} onClick={() => void openDocument(policy)} style={{ cursor: "pointer" }}>
                        <td>{policy.title}</td>
                        <td className="code" dir="ltr" style={{ textAlign: "start" }}>
                          {policyReference(policy) ?? "—"}
                        </td>
                        <td>{classification.departmentLabel}</td>
                        <td>{formatDate(policy.policy_metadata?.review_date ?? policy.next_review_at)}</td>
                        <td>
                          <span className={`pill ${urgency.tone}`}>{urgency.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">المؤشرات</span>
            <h2>الإدارات والاعتماد</h2>
            <div className="orbit-divider" aria-hidden="true">
              <span className="tick" />
              <span className="medallion" />
              <span className="tick" />
            </div>
          </div>

          <div className="grid grid-2">
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>الإدارة</th>
                    <th className="num">مُعتمد</th>
                    <th className="num">بانتظار</th>
                    <th className="num">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {departmentRows.length === 0 ? (
                    <tr>
                      <td colSpan={4}>لا توجد بيانات.</td>
                    </tr>
                  ) : (
                    departmentRows.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td className="num">{row.approved}</td>
                        <td className="num">{row.pending}</td>
                        <td className="num">{row.total}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h3 style={{ marginBlockEnd: "var(--space-5)" }}>الاعتماد النهائي · ٦ أشهر</h3>
              <div className="trend-bars" role="img" aria-label="الاعتماد النهائي خلال الأشهر الستة الأخيرة">
                {trend.map((point, index) => (
                  <div className="trend-col" key={index} title={`${point.label}: ${point.count}`}>
                    <span className="trend-value">{point.count}</span>
                    <span className="trend-track">
                      <span
                        className="trend-fill"
                        style={{ blockSize: `${point.count > 0 ? Math.max(point.pct, 6) : 2}%` }}
                      />
                    </span>
                    <em className="trend-label">{point.label}</em>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">السجل</span>
            <h2>آخر الاعتمادات</h2>
            <div className="orbit-divider" aria-hidden="true">
              <span className="tick" />
              <span className="medallion" />
              <span className="tick" />
            </div>
          </div>

          {recentFinal.length === 0 ? (
            <div className="empty">
              <h3>لا يوجد سجل بعد</h3>
              <p>تظهر السياسات هنا فور اعتمادها.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>السياسة</th>
                    <th>الرمز</th>
                    <th>تاريخ الإصدار</th>
                    <th>تاريخ المراجعة</th>
                    <th>تاريخ الاعتماد</th>
                    <th>الحالة</th>
                    <th>الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {recentFinal.map((policy) => (
                    <tr
                      key={policy.id}
                      onClick={() => void openDocument(policy)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>{policy.title}</td>
                      <td className="code" dir="ltr" style={{ textAlign: "start" }}>
                        {policyReference(policy) ?? "—"}
                      </td>
                      <td>{formatDate(policy.policy_metadata?.issue_date ?? policy.approved_at)}</td>
                      <td>{formatDate(policy.policy_metadata?.review_date ?? policy.next_review_at)}</td>
                      <td>{formatDate(policy.final_approved_at)}</td>
                      <td>
                        <span className="stamped-status">
                          <span className="pill success">مُعتمد</span>
                          {stampPublicUrl(policy.final_stamp_path) ? (
                            <img
                              className="stamp-seal"
                              src={stampPublicUrl(policy.final_stamp_path) ?? undefined}
                              alt="ختم الاعتماد النهائي"
                              title="ختم الاعتماد النهائي"
                            />
                          ) : null}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-quiet btn-unapprove"
                          disabled={busy === policy.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void unapprovePolicy(policy);
                          }}
                        >
                          <RotateCcw size={15} aria-hidden="true" />
                          إلغاء الاعتماد
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {pending.length > 0 ? (
        <div className="dock">
          <span>
            <strong>{pending.length}</strong> سياسة بانتظار الاعتماد
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={approvingAll}
            onClick={() => void approveAll()}
          >
            {approvingAll ? "جاري الاعتماد..." : "اعتماد الكل"}
          </button>
        </div>
      ) : null}

      <PoweredBy />
    </div>
  );
}
