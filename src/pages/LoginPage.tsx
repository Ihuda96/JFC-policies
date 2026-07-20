import { FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, KeyRound, Mail } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { hasSupabaseConfig } from "../lib/config";
import { errorMessage, supabase } from "../lib/supabase";
import { SetupRequired } from "../components/SetupRequired";

export function LoginPage() {
  const { session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? "/app";

  if (!hasSupabaseConfig || !supabase) {
    return <SetupRequired />;
  }

  if (session) {
    return <Navigate to={from} replace />;
  }

  async function resolveIdentifierEmail() {
    const trimmed = identifier.trim();
    if (trimmed.includes("@")) {
      return trimmed.toLowerCase();
    }

    const { data, error: resolveError } = await supabase!.rpc("resolve_login_identifier", {
      p_identifier: trimmed,
    });

    if (resolveError) {
      throw resolveError;
    }

    if (typeof data !== "string" || data.length === 0) {
      throw new Error("اسم المستخدم غير موجود أو غير مفعل.");
    }

    return data;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const resolvedEmail = await resolveIdentifierEmail();
      if (mode === "reset") {
        const { error: resetError } = await supabase!.auth.resetPasswordForEmail(resolvedEmail, {
          redirectTo: `${window.location.origin}/login`,
        });
        if (resetError) {
          throw resetError;
        }
        setMessage("تم إرسال رابط استعادة كلمة المرور إذا كان البريد مسجلًا.");
      } else {
        const { error: loginError } = await supabase!.auth.signInWithPassword({
          email: resolvedEmail,
          password,
        });
        if (loginError) {
          throw loginError;
        }
        navigate(from, { replace: true });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <Link to="/" className="back-link">
          <ArrowRight aria-hidden="true" />
          العودة للصفحة التعريفية
        </Link>
        <img src="/brand/jfc-logo-stacked-white-alt.jpg" alt="تجمع جدة الصحي الأول" />
        <p className="eyebrow">منصة إدارة السياسات</p>
        <h1>{mode === "login" ? "تسجيل الدخول" : "استعادة كلمة المرور"}</h1>
        <form onSubmit={submit}>
          <label>
            <span>البريد الإلكتروني أو اسم المستخدم</span>
            <div className="input-shell">
              <Mail aria-hidden="true" />
              <input
                type="text"
                required
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                autoComplete="username"
              />
            </div>
          </label>
          {mode === "login" ? (
            <label>
              <span>كلمة المرور</span>
              <div className="input-shell">
                <KeyRound aria-hidden="true" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </div>
            </label>
          ) : null}
          {error ? <p className="inline-error">{error}</p> : null}
          {message ? <p className="inline-success">{message}</p> : null}
          <button className="primary-button full" disabled={loading}>
            {loading ? "جاري التنفيذ..." : mode === "login" ? "دخول" : "إرسال الرابط"}
          </button>
        </form>
        <button className="text-button" onClick={() => setMode(mode === "login" ? "reset" : "login")}>
          {mode === "login" ? "نسيت كلمة المرور؟" : "العودة لتسجيل الدخول"}
        </button>
      </section>
    </main>
  );
}
