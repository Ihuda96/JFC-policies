import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, UserRound } from "lucide-react";
import { hasSupabaseConfig } from "../../lib/config";
import { errorMessage, supabase } from "../../lib/supabase";
import { SetupRequired } from "../../components/SetupRequired";

export function ExecutiveLoginPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasSupabaseConfig || !supabase) {
    return <SetupRequired />;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const trimmed = identifier.trim();
      let email = trimmed.toLowerCase();

      if (!trimmed.includes("@")) {
        const { data, error: resolveError } = await supabase!.rpc("resolve_login_identifier", {
          p_identifier: trimmed,
        });
        if (resolveError) throw resolveError;
        if (typeof data !== "string" || data.length === 0) {
          throw new Error("اسم المستخدم غير معروف.");
        }
        email = data;
      }

      const { error: loginError } = await supabase!.auth.signInWithPassword({ email, password });
      if (loginError) throw loginError;

      navigate("/executive", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="exec-portal gov-auth-page">
      <section className="gov-auth-card">
        <span className="gov-mark gov-auth-mark">JF</span>
        <p className="gov-eyebrow-dark">تجمع جدة الصحي الأول</p>
        <h1>الحوكمة التنفيذية</h1>
        <form onSubmit={submit}>
          <label>
            <span>اسم المستخدم</span>
            <div className="gov-field">
              <UserRound aria-hidden="true" />
              <input
                dir="ltr"
                type="text"
                required
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                autoComplete="username"
              />
            </div>
          </label>
          <label>
            <span>كلمة الدخول</span>
            <div className="gov-field">
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
          {error ? <p className="gov-auth-error">{error}</p> : null}
          <button className="gov-btn-primary gov-auth-submit" disabled={loading}>
            {loading ? "جاري الدخول..." : "دخول"}
          </button>
        </form>
      </section>
    </main>
  );
}
