import { AlertTriangle, Clock, LifeBuoy } from "lucide-react";

export function SetupRequired({ message }: { message?: string | null }) {
  void message;

  return (
    <main className="setup-screen">
      <section className="setup-panel">
        <div className="setup-icon">
          <AlertTriangle aria-hidden="true" />
        </div>
        <p className="eyebrow">الخدمة غير متاحة مؤقتًا</p>
        <h1>تعذّر عرض البيانات في الوقت الحالي</h1>
        <p>
          نعتذر عن هذا الانقطاع المؤقت. يرجى إعادة تحميل الصفحة بعد قليل، وإذا
          استمرت المشكلة تواصل مع الدعم الفني لمساعدتك.
        </p>
        <div className="setup-list">
          <div>
            <Clock aria-hidden="true" />
            <span>أعد تحميل الصفحة بعد قليل</span>
          </div>
          <div>
            <LifeBuoy aria-hidden="true" />
            <span>تواصل مع الدعم الفني إذا استمرت المشكلة</span>
          </div>
        </div>
      </section>
    </main>
  );
}
