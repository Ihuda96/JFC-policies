import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { hasSupabaseConfig } from "../../lib/config";
import { errorMessage, supabase } from "../../lib/supabase";
import { PoweredBy } from "../../components/PoweredBy";
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
    <main className="exec-portal auth-page">
      <section className="auth-card bloom-corner">
        <span className="seal" aria-hidden="true">
          <img src="/brand/jfc-emblem.png" alt="" />
        </span>
        <h1>مكتب الرئيس التنفيذي</h1>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="exec-username">اسم المستخدم</label>
            <input
              id="exec-username"
              className="input"
              dir="ltr"
              type="text"
              required
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="field">
            <label htmlFor="exec-password">كلمة الدخول</label>
            <input
              id="exec-password"
              className="input"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </div>
          {error ? <p className="auth-error">{error}</p> : null}
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ justifyContent: "center" }}>
            {loading ? "جاري الدخول..." : "دخول"}
          </button>
        </form>
      </section>
      <PoweredBy />
    </main>
  );
}
