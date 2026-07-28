import { FormEvent, useState } from "react";
import { KeyRound } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { errorMessage, supabase } from "../../lib/supabase";

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
    <main className="exec-portal exec-login">
      <div className="exec-login-frame">
        <div className="exec-login-brand">
          <span className="exec-rule" />
          <p>المكتب التنفيذي</p>
          <h1>اختر كلمة الدخول</h1>
        </div>

        <form className="exec-login-form" onSubmit={submit}>
          <label>
            <span>كلمة الدخول الجديدة</span>
            <div className="exec-field">
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
            <span>تأكيد كلمة الدخول</span>
            <div className="exec-field">
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
          {error ? <p className="exec-error">{error}</p> : null}
          <button className="exec-button" disabled={loading}>
            {loading ? "جاري الحفظ..." : "حفظ ومتابعة"}
          </button>
        </form>
      </div>
    </main>
  );
}
