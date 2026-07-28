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
    <main className="exec-portal exec-login">
      <div className="exec-login-frame">
        <div className="exec-login-brand">
          <img src="/brand/jfc-logo-stacked-white-alt.jpg" alt="تجمع جدة الصحي الأول" />
          <span className="exec-rule" />
          <p>تجمع جدة الصحي الأول</p>
          <h1>المكتب التنفيذي</h1>
        </div>

        <form className="exec-login-form" onSubmit={submit}>
          <label>
            <span>اسم المستخدم</span>
            <div className="exec-field">
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
            <div className="exec-field">
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
          {error ? <p className="exec-error">{error}</p> : null}
          <button className="exec-button" disabled={loading}>
            {loading ? "جاري الدخول..." : "دخول"}
          </button>
        </form>
      </div>
    </main>
  );
}
