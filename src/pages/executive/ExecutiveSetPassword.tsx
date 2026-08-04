import { FormEvent, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { errorMessage, supabase } from "../../lib/supabase";
import { PoweredBy } from "../../components/PoweredBy";

/** Shown the first time an executive signs in with a password issued by the
 *  administrator, so they immediately choose their own. */
export function ExecutiveSetPassword() {
  const { refreshProfile } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password.length < 8) {
      setError("كلمة المرور يجب ألا تقل عن ٨ خانات.");
      return;
    }
    if (password !== confirmPassword) {
      setError("كلمتا المرور غير متطابقتين.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: updateError } = await supabase!.auth.updateUser({ password });
      if (updateError) throw updateError;

      const { error: rpcError } = await supabase!.rpc("complete_password_change");
      if (rpcError) throw rpcError;

      await refreshProfile();
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
        <h1>اختر كلمة الدخول</h1>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="exec-new-password">كلمة الدخول الجديدة</label>
            <input
              id="exec-new-password"
              className="input"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="field">
            <label htmlFor="exec-confirm-password">تأكيد كلمة الدخول</label>
            <input
              id="exec-confirm-password"
              className="input"
              type="password"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
          </div>
          {error ? <p className="auth-error">{error}</p> : null}
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ justifyContent: "center" }}>
            {loading ? "جاري الحفظ..." : "حفظ ومتابعة"}
          </button>
        </form>
      </section>
      <PoweredBy />
    </main>
  );
}
