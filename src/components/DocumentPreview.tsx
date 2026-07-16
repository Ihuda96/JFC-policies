import { Download, ExternalLink, FileText, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fileSize } from "../lib/format";
import { readableWorkflowError, signedFileUrl } from "../lib/policyWorkflow";
import type { PolicyFile } from "../lib/types";
import { LoadingState } from "./LoadingState";

export function DocumentPreview({ file }: { file?: PolicyFile | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isPdf = useMemo(
    () => file?.content_type === "application/pdf" || file?.file_name.toLowerCase().endsWith(".pdf"),
    [file],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!file) {
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const signed = await signedFileUrl(file, "preview");
        if (!cancelled) {
          setUrl(signed);
        }
      } catch (err) {
        if (!cancelled) {
          setError(readableWorkflowError(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [file, isPdf]);

  async function openFile(action: "download" | "print") {
    if (!file) {
      return;
    }

    try {
      const signed = await signedFileUrl(file, action);
      window.open(signed, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(readableWorkflowError(err));
    }
  }

  if (!file) {
    return (
      <div className="preview-panel no-file">
        <FileText aria-hidden="true" />
        <p>لا يوجد ملف مرتبط بهذه النسخة.</p>
      </div>
    );
  }

  return (
    <section className="preview-panel">
      <div className="preview-toolbar">
        <div>
          <strong>{file.file_name}</strong>
          <span>{fileSize(file.file_size)}</span>
        </div>
        <div className="toolbar-actions">
          <button onClick={() => void openFile("download")}>
            <Download aria-hidden="true" />
            تنزيل
          </button>
          <button onClick={() => void openFile("print")}>
            <Printer aria-hidden="true" />
            طباعة
          </button>
          {url ? (
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" />
              فتح
            </a>
          ) : null}
        </div>
      </div>

      {loading ? <LoadingState label="جاري إنشاء رابط معاينة مؤقت..." /> : null}
      {error ? <p className="inline-error">{error}</p> : null}
      {!loading && !error && isPdf && url ? (
        <iframe className="pdf-frame" src={url} title={file.file_name} />
      ) : null}
      {!loading && !error && !isPdf ? (
        <div className="word-preview-state">
          <FileText aria-hidden="true" />
          <h3>معاينة دقيقة مطلوبة</h3>
          <p>
            هذا ملف DOCX أصلي. لتدقيق التنسيق والمنتج النهائي بدقة يجب رفع PDF
            مطابق مصدّر من Word لهذه النسخة، ثم سيظهر هنا داخل العارض.
          </p>
        </div>
      ) : null}
    </section>
  );
}
