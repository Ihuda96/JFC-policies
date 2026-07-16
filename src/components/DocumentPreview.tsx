import { Download, ExternalLink, FileText, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fileSize } from "../lib/format";
import { readableWorkflowError, signedFileUrl } from "../lib/policyWorkflow";
import type { PolicyFile } from "../lib/types";
import { LoadingState } from "./LoadingState";

export function DocumentPreview({ file }: { file?: PolicyFile | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [docxMessages, setDocxMessages] = useState<string[]>([]);
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
      setDocxHtml(null);
      setDocxMessages([]);
      try {
        const signed = await signedFileUrl(file, "preview");
        if (!cancelled) {
          setUrl(signed);
        }

        if (!isPdf) {
          const response = await fetch(signed);
          if (!response.ok) {
            throw new Error("تعذر تحميل ملف Word للمعاينة.");
          }

          const arrayBuffer = await response.arrayBuffer();
          const { default: mammoth } = await import("mammoth/mammoth.browser");
          const converted = await mammoth.convertToHtml(
            { arrayBuffer },
            {
              styleMap: [
                "p[style-name='Title'] => h1:fresh",
                "p[style-name='Heading 1'] => h1:fresh",
                "p[style-name='Heading 2'] => h2:fresh",
                "p[style-name='Heading 3'] => h3:fresh",
                "b => strong",
                "i => em",
              ],
            },
          );

          if (!cancelled) {
            setDocxHtml(converted.value);
            setDocxMessages(converted.messages.map((message) => message.message));
          }
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
      {!loading && !error && !isPdf && docxHtml ? (
        <>
          {docxMessages.length > 0 ? (
            <div className="preview-note">
              تم عرض محتوى Word من الملف الأصلي. قد تختلف بعض عناصر التنسيق
              المتقدمة عن Word، والملف الأصلي متاح دائمًا للتنزيل.
            </div>
          ) : null}
          <iframe
            className="docx-frame"
            sandbox=""
            title={`معاينة ${file.file_name}`}
            srcDoc={`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /><style>
              body{font-family:'Janna LT','Segoe UI',Tahoma,Arial,sans-serif;margin:0;padding:32px;color:#162232;line-height:1.9;background:#fff}
              h1,h2,h3{color:#073861;line-height:1.35;margin:1.2em 0 .45em}
              p{margin:.65em 0}
              table{border-collapse:collapse;width:100%;margin:1em 0}
              td,th{border:1px solid #dce6ed;padding:8px;vertical-align:top}
              img{max-width:100%;height:auto}
              ul,ol{padding-inline-start:1.6rem}
            </style></head><body><main class="docx-content">${docxHtml}</main></body></html>`}
          />
        </>
      ) : null}
      {!loading && !error && !isPdf && !docxHtml ? (
        <div className="word-preview-state">
          <FileText aria-hidden="true" />
          <h3>جاري تجهيز معاينة Word</h3>
          <p>سيظهر محتوى DOCX هنا من الملف الأصلي عند اكتمال التحويل داخل المتصفح.</p>
        </div>
      ) : null}
    </section>
  );
}
