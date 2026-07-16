import {
  ArrowLeft,
  Bell,
  BookOpen,
  CheckCircle2,
  FileSearch,
  FileText,
  Lock,
  MessageSquareText,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { Link } from "react-router-dom";

const capabilities = [
  { icon: FileSearch, title: "معاينة داخلية", body: "PDF مباشرة وDOCX عبر نسخة معاينة خلفية عند توفر خدمة التحويل." },
  { icon: MessageSquareText, title: "ملاحظات مرتبطة", body: "إعادة للتعديل بملاحظات إلزامية وسجل واضح لكل نسخة." },
  { icon: BookOpen, title: "مكتبة موحدة", body: "بحث وتصنيف حسب قطاعات وإدارات التجمع، لا حسب المنشآت." },
  { icon: Bell, title: "إشعارات عملية", body: "كل إشعار يفتح السياسة أو المهمة المطلوبة مباشرة." },
];

export function LandingPage() {
  return (
    <main className="landing-page">
      <header className="landing-header">
        <Link to="/" className="landing-brand">
          <img src="/brand/jfc-logo-stacked-white.jpg" alt="تجمع جدة الصحي الأول" />
          <span>منصة السياسات</span>
        </Link>
        <nav aria-label="روابط الصفحة">
          <a href="#workflow">الرحلة</a>
          <a href="#governance">الحوكمة</a>
          <Link to="/login">الدخول</Link>
        </nav>
      </header>

      <section className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow">تجمع جدة الصحي الأول</p>
          <h1>سياسات موحدة، اعتماد أسرع، معرفة موثوقة</h1>
          <p>
            رحلة رقمية واحدة من رفع النسخة المعدلة إلى مراجعتها واعتمادها
            ونشرها في مكتبة قابلة للبحث والمعاينة والتنزيل.
          </p>
          <div className="hero-actions">
            <Link className="primary-button" to="/login">
              الدخول إلى المنصة
              <ArrowLeft aria-hidden="true" />
            </Link>
            <a className="secondary-button" href="#workflow">
              مشاهدة رحلة السياسة
            </a>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="document-card floating">
            <FileText />
            <span>سياسة مكافحة العدوى</span>
            <strong>بانتظار الاعتماد</strong>
          </div>
          <div className="journey-line" />
          <div className="hero-stamp">
            <CheckCircle2 />
            <span>اعتماد ونشر</span>
          </div>
        </div>
      </section>

      <section className="landing-band" id="workflow">
        <div className="section-heading">
          <p className="eyebrow">رحلة السياسة</p>
          <h2>من شاشة رفع واحدة إلى مكتبة معتمدة</h2>
        </div>
        <div className="workflow-grid">
          {["رفع", "معاينة", "مراجعة", "اعتماد", "نشر"].map((step, index) => (
            <article key={step}>
              <span>{index + 1}</span>
              <h3>{step}</h3>
              <p>
                {index === 0
                  ? "يرفع موظف الجودة ملف DOCX أو PDF دون نموذج طويل."
                  : index === 1
                    ? "تظهر المعاينة داخل المنصة ويبدأ الاستخراج الخلفي."
                    : index === 2
                      ? "يراجع مدير الجودة الملف ويضيف الملاحظات من نفس الصفحة."
                      : index === 3
                        ? "الاعتماد يثبت النسخة الحالية ويسجل القرار."
                        : "تظهر السياسة فورًا في المكتبة حسب الصلاحيات."}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="capability-section">
        <div className="capability-copy">
          <p className="eyebrow">النظام الداخلي</p>
          <h2>عملي وسريع ومبني للصلاحيات</h2>
          <p>
            الواجهة الداخلية تركّز على تنفيذ المهمة: رفع، إرسال، مراجعة، إعادة
            للتعديل، اعتماد، ثم بحث وتنزيل وطباعة من المكتبة.
          </p>
        </div>
        <div className="capability-grid">
          {capabilities.map((item) => (
            <article key={item.title}>
              <item.icon aria-hidden="true" />
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="governance-section" id="governance">
        <div>
          <p className="eyebrow">الحوكمة والأمان</p>
          <h2>Supabase Auth وRLS وتخزين خاص</h2>
          <p>
            لا تعتمد المنصة على مفاتيح سرية في المتصفح. كل الملفات تحفظ في
            حاويات خاصة، والوصول يتم بروابط موقعة ومؤقتة بعد التحقق من الصلاحية.
          </p>
        </div>
        <div className="governance-cards">
          <span><Lock /> ملفات خاصة قبل الاعتماد</span>
          <span><ShieldCheck /> RLS على الجداول والتخزين</span>
          <span><Workflow /> سجل تدقيق لكل إجراء حساس</span>
        </div>
      </section>
    </main>
  );
}
