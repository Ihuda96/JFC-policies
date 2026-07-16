import { ChangeEvent, FormEvent, useState } from "react";
import { CheckCircle2, FileUp, Send } from "lucide-react";
import { Link } from "react-router-dom";
import {
  readableWorkflowError,
  submitPolicyVersion,
  uploadPolicyDraft,
} from "../lib/policyWorkflow";

export function UploadPolicyPage() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ policyId: string; versionId: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setResult(null);
    setError(null);
  }

  const isDocx = Boolean(file && file.name.toLowerCase().endsWith(".docx"));

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("اختر ملف PDF أو DOCX أولًا.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const uploaded = await uploadPolicyDraft({ file, title, note });
      setResult(uploaded);
    } catch (err) {
      setError(readableWorkflowError(err));
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!result) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await submitPolicyVersion(result.policyId, result.versionId, note);
    } catch (err) {
      setError(readableWorkflowError(err));
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    window.location.assign(`/app/policies/${result.policyId}`);
  }

  return (
    <div className="page-stack">
      <section className="page-hero compact">
        <div>
          <p className="eyebrow">شاشة واحدة</p>
          <h1>إضافة سياسة</h1>
          <p>ارفع ملف السياسة، راجعه، ثم أرسله للاعتماد دون نموذج طويل.</p>
        </div>
      </section>

      <section className="upload-layout">
        <form className="upload-card" onSubmit={upload}>
          <label>
            <span>عنوان اختياري</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="يُستخدم اسم الملف تلقائيًا إذا ترك فارغًا"
            />
          </label>
          <label>
            <span>ملاحظة لمدير الجودة</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="اختياري"
              rows={4}
            />
          </label>
          <label className="dropzone">
            <FileUp aria-hidden="true" />
            <strong>{file ? file.name : "اسحب الملف هنا أو اختر من الجهاز"}</strong>
            <span>PDF أو DOCX فقط</span>
            <input
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={onFileChange}
            />
          </label>
          {isDocx ? (
            <div className="note-box">
              سيتم حفظ Word الأصلي وإنشاء مهمة تحويل PDF تلقائية للمعاينة الدقيقة.
              تظهر المعاينة عندما ينهي Worker التحويل.
            </div>
          ) : null}
          {error ? <p className="inline-error">{error}</p> : null}
          <button
            className="primary-button full"
            disabled={loading || !file || Boolean(result)}
          >
            {loading ? "جاري الرفع..." : result ? "تم الرفع" : "رفع ومعاينة"}
          </button>
        </form>

        <aside className="upload-preview-card">
          {result ? (
            <>
              <CheckCircle2 aria-hidden="true" />
              <h2>تم حفظ النسخة</h2>
              <p>
                الملف محفوظ الآن في Storage خاص، وسُجلت مهمة المعالجة الخلفية.
                يمكنك إرسال النسخة للاعتماد.
              </p>
              <div className="stacked-actions">
                <button className="primary-button full" onClick={() => void submit()} disabled={submitting}>
                  <Send aria-hidden="true" />
                  {submitting ? "جاري الإرسال..." : "إرسال للاعتماد"}
                </button>
                <Link className="secondary-button full" to={`/app/policies/${result.policyId}`}>
                  فتح الطلب
                </Link>
              </div>
            </>
          ) : (
            <>
              <FileUp aria-hidden="true" />
              <h2>المعاينة بعد الرفع</h2>
              <p>
                بعد نجاح الرفع سيظهر الطلب ويمكن فتح الملف من صفحة السياسة عبر
                رابط Supabase مؤقت. لا تُنشأ بيانات وهمية أو ملفات بديلة.
              </p>
            </>
          )}
        </aside>
      </section>
    </div>
  );
}
