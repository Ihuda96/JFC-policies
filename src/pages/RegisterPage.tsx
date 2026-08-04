import { FormEvent, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowRight, Building2, CheckCircle2, KeyRound, UserRound } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { hasSupabaseConfig } from "../lib/config";
import { DEPARTMENT_UNITS } from "../lib/departments";
import { loginEmailForUsername } from "../lib/loginIdentity";
import { createDetachedSupabaseClient, errorMessage } from "../lib/supabase";
import { PoweredBy } from "../components/PoweredBy";
import { SetupRequired } from "../components/SetupRequired";

export function RegisterPage() {
  const { session } = useAuth();
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [departmentCode, setDepartmentCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const departments = useMemo(() => DEPARTMENT_UNITS, []);

  if (!hasSupabaseConfig) {
    return <SetupRequired />;
  }

  if (session && !submitted) {
    return <Navigate to="/app" replace />;
  }

  function validate() {
    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(cleanUsername)) {
      return "اسم المستخدم يجب أن يكون من ٣ إلى ٣٢ حرفًا إنجليزيًا أو رقمًا بدون مسافات.";
    }
    if (fullName.trim().length < 3) {
      return "يرجى كتابة الاسم الكامل.";
    }
    if (!departmentCode) {
      return "يرجى اختيار الإدارة.";
    }
    if (password.length < 8) {
      return "كلمة المرور يجب ألا تقل عن ٨ خانات.";
    }
    if (password !== confirmPassword) {
      return "كلمتا المرور غير متطابقتين.";
    }
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }

    const client = createDetachedSupabaseClient();
    if (!client) {
      setError("تعذّر الاتصال بالخدمة حاليًا. يرجى المحاولة لاحقًا.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const cleanUsername = username.trim().toLowerCase();
      const department = departments.find((unit) => unit.code === departmentCode);

      const { error: signUpError } = await client.auth.signUp({
        email: loginEmailForUsername(cleanUsername),
        password,
        options: {
          data: {
            username: cleanUsername,
            full_name: fullName.trim(),
            department: department?.label ?? "",
            department_code: departmentCode,
            requested_role: "department_staff",
          },
        },
      });

      if (signUpError) {
        throw signUpError;
      }

      await client.auth.signOut();
      setSubmitted(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <main className="login-page">
        <section className="login-card register-done">
          <span className="register-done-icon">
            <CheckCircle2 aria-hidden="true" />
          </span>
          <h1>تم استلام طلبك</h1>
          <p>
            سيصلك التفعيل بعد اعتماد الطلب من إدارة النظام. بعدها يمكنك الدخول
            باسم المستخدم وكلمة المرور التي اخترتها.
          </p>
          <Link className="primary-button full" to="/login">
            الذهاب لتسجيل الدخول
          </Link>
        </section>
        <PoweredBy />
      </main>
    );
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <Link to="/login" className="back-link">
          <ArrowRight aria-hidden="true" />
          العودة لتسجيل الدخول
        </Link>
        <img src="/brand/jfc-logo-stacked-white-alt.jpg" alt="تجمع جدة الصحي الأول" />
        <p className="eyebrow">حساب جديد</p>
        <h1>تسجيل موظف إدارة</h1>
        <p className="login-lede">
          سجّل بياناتك لإضافة سياسات إدارتك. يبدأ الحساب بعد اعتماده من إدارة
          النظام.
        </p>
        <form onSubmit={submit}>
          <label>
            <span>اسم المستخدم</span>
            <div className="input-shell">
              <UserRound aria-hidden="true" />
              <input
                type="text"
                required
                dir="ltr"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="huda.ali"
                autoComplete="username"
              />
            </div>
          </label>
          <label>
            <span>الاسم الكامل</span>
            <div className="input-shell">
              <UserRound aria-hidden="true" />
              <input
                type="text"
                required
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
              />
            </div>
          </label>
          <label>
            <span>الإدارة</span>
            <div className="input-shell">
              <Building2 aria-hidden="true" />
              <select
                required
                value={departmentCode}
                onChange={(event) => setDepartmentCode(event.target.value)}
              >
                <option value="">اختر الإدارة</option>
                {departments.map((unit) => (
                  <option key={unit.code} value={unit.code}>
                    {unit.label}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label>
            <span>كلمة المرور</span>
            <div className="input-shell">
              <KeyRound aria-hidden="true" />
              <input
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>
          </label>
          <label>
            <span>تأكيد كلمة المرور</span>
            <div className="input-shell">
              <KeyRound aria-hidden="true" />
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>
          </label>
          {error ? <p className="inline-error">{error}</p> : null}
          <button className="primary-button full" disabled={loading}>
            {loading ? "جاري الإرسال..." : "إرسال طلب التسجيل"}
          </button>
        </form>
      </section>
      <PoweredBy />
    </main>
  );
}
