import { AlertTriangle, Database, FileText, ShieldCheck } from "lucide-react";
import { deploymentProject } from "../lib/config";

export function SetupRequired({ message }: { message?: string | null }) {
  return (
    <main className="setup-screen">
      <section className="setup-panel">
        <div className="setup-icon">
          <AlertTriangle aria-hidden="true" />
        </div>
        <p className="eyebrow">إعداد مطلوب</p>
        <h1>قاعدة البيانات أو إعدادات Supabase غير جاهزة بعد</h1>
        <p>
          التطبيق لا يعرض بيانات تجريبية عند غياب المخطط. شغّل ملف النشر اليدوي
          على مشروع Supabase ثم أعد تحميل الصفحة.
        </p>
        {message ? <p className="setup-error">{message}</p> : null}
        <div className="setup-list">
          <div>
            <Database aria-hidden="true" />
            <span>{deploymentProject.ref}</span>
          </div>
          <div>
            <FileText aria-hidden="true" />
            <span>supabase/DEPLOY_TO_SUPABASE.sql</span>
          </div>
          <div>
            <ShieldCheck aria-hidden="true" />
            <span>RLS و Storage private مطلوبة قبل الاستخدام</span>
          </div>
        </div>
      </section>
    </main>
  );
}
