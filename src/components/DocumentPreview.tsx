import { Download, ExternalLink, FileText, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fileSize } from "../lib/format";
import { readableWorkflowError, signedFileUrl } from "../lib/policyWorkflow";
import type { PolicyFile } from "../lib/types";
import { LoadingState } from "./LoadingState";

const OFFICE_VIEWER_URL = "https://view.officeapps.live.com/op/embed.aspx?src=";
const officePreviewEnabled = import.meta.env.VITE_ENABLE_OFFICE_DOCX_PREVIEW !== "false";

export function DocumentPreview({ file }: { file?: PolicyFile | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isPdf = useMemo(
    () =>
      file?.content_type === "application/pdf" ||
      file?.file_name.toLowerCase().endsWith(".pdf"),
    [file],
  );
  const isDocx = useMemo(
    () =>
      file?.content_type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file?.file_name.toLowerCase().endsWith(".docx"),
    [file],
  );
  const officePreviewUrl =
    officePreviewEnabled && isDocx && url
      ? `${OFFICE_VIEWER_URL}${encodeURIComponent(url)}`
      : null;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setUrl(null);
      setError(null);

      if (!file || (!isPdf && !isDocx)) {
        setLoading(false);
        return;
      }

      setLoading(true);
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
  }, [file, isPdf, isDocx]);

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
            {isPdf ? "تنزيل PDF" : "تنزيل Word"}
          </button>
          {isPdf ? (
            <button onClick={() => void openFile("print")}>
              <Printer aria-hidden="true" />
              طباعة
            </button>
          ) : null}
          {url ? (
            <a href={officePreviewUrl ?? url} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" />
              {isDocx ? "فتح المعاينة" : "فتح"}
            </a>
          ) : null}
        </div>
      </div>

      {loading ? <LoadingState label="جاري إنشاء رابط معاينة مؤقت..." inline /> : null}
      {error ? <p className="inline-error">{error}</p> : null}
      {!loading && !error && isPdf && url ? (
        <iframe className="pdf-frame" src={url} title={file.file_name} />
      ) : null}
      {!loading && !error && officePreviewUrl ? (
        <div className="docx-preview-shell">
          <div className="preview-notice">
            معاينة Word مباشرة من الملف الأصلي.
          </div>
          <iframe className="office-frame" src={officePreviewUrl} title={file.file_name} />
        </div>
      ) : null}
      {!loading && !error && isDocx && !officePreviewUrl ? (
        <div className="word-preview-state">
          <FileText aria-hidden="true" />
          <h3>جاري تجهيز معاينة الملف</h3>
          <p>
            هذا ملف DOCX أصلي. سيتم إنشاء رابط معاينة Word مؤقت من الملف المحفوظ.
          </p>
        </div>
      ) : null}
    </section>
  );
}
