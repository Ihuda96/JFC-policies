import { FormEvent, useEffect, useState } from "react";
import { Crown, Eye, EyeOff, KeyRound, RefreshCw } from "lucide-react";
import { loginEmailForUsername } from "../../lib/loginIdentity";
import { createDetachedSupabaseClient, errorMessage, supabase } from "../../lib/supabase";
import { useToast } from "../Toast";
import type { Profile } from "../../lib/types";

interface IssuedPassword {
  user_id: string;
  password_plain: string | null;
  issued_at: string;
  consumed_at: string | null;
}

function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) {
    out += alphabet[byte % alphabet.length];
  }
  return out;
}

export function AdminExecutiveAccount() {
  const toast = useToast();
  const [executives, setExecutives] = useState<Profile[]>([]);
  const [issued, setIssued] = useState<Record<string, IssuedPassword>>({});
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");

  async function load() {
    if (!supabase) return;

    const [{ data: profiles }, { data: passwords }] = await Promise.all([
      supabase.from("profiles").select("*").eq("role", "ceo").order("created_at"),
      supabase.from("admin_issued_passwords").select("*"),
    ]);

    setExecutives((profiles as Profile[]) ?? []);
    const map: Record<string, IssuedPassword> = {};
    for (const row of (passwords as IssuedPassword[]) ?? []) {
      map[row.user_id] = row;
    }
    setIssued(map);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createExecutive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = createDetachedSupabaseClient();
    if (!client || !supabase) {
      toast.error("تعذّر الاتصال بالخدمة حاليًا.");
      return;
    }

    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(cleanUsername)) {
      toast.error("اسم المستخدم يجب أن يكون حروفًا إنجليزية أو أرقامًا بدون مسافات.");
      return;
    }

    setCreating(true);
    const initialPassword = randomPassword();

    try {
      const { data, error } = await client.auth.signUp({
        email: loginEmailForUsername(cleanUsername),
        password: initialPassword,
        options: {
          data: { username: cleanUsername, full_name: fullName.trim() },
        },
      });
      if (error) throw error;
      const userId = data.user?.id;
      if (!userId) {
        throw new Error("تعذّر إنشاء الحساب. جرّب اسم مستخدم آخر.");
      }

      // Wait for the profile row created by the database trigger.
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const { data: row } = await supabase
          .from("profiles")
          .select("id")
          .eq("id", userId)
          .maybeSingle();
        if (row) break;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }

      const { error: profileError } = await supabase.rpc("admin_update_profile", {
        p_user_id: userId,
        p_username: cleanUsername,
        p_full_name: fullName.trim(),
        p_role: "ceo",
        p_status: "active",
        p_department: "",
        p_job_title: "الرئيس التنفيذي",
        p_phone: "",
      });
      if (profileError) throw profileError;

      const { error: passwordError } = await supabase.rpc("admin_set_user_password", {
        p_user_id: userId,
        p_password: initialPassword,
      });
      if (passwordError) throw passwordError;

      await client.auth.signOut();
      setUsername("");
      setFullName("");
      toast.success("تم إنشاء حساب الرئيس التنفيذي.");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function resetPassword(profile: Profile) {
    if (!supabase) return;
    setBusy(profile.id);
    try {
      const next = randomPassword();
      const { error } = await supabase.rpc("admin_set_user_password", {
        p_user_id: profile.id,
        p_password: next,
      });
      if (error) throw error;
      setRevealed((current) => new Set(current).add(profile.id));
      toast.success("تم إصدار كلمة مرور جديدة.");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function toggleReveal(id: string) {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <section className="data-section">
      <div className="section-title-row">
        <h2>حساب الرئيس التنفيذي</h2>
      </div>

      <div className="exec-account-list">
        {executives.length === 0 ? (
          <p className="chart-empty">لا يوجد حساب حتى الآن.</p>
        ) : (
          executives.map((profile) => {
            const record = issued[profile.id];
            const pending = Boolean(profile.must_change_password && record?.password_plain);
            const show = revealed.has(profile.id);

            return (
              <article className="exec-account-card" key={profile.id}>
                <div className="exec-account-head">
                  <span className="exec-account-avatar">
                    <Crown aria-hidden="true" />
                  </span>
                  <div>
                    <strong>{profile.full_name ?? "الرئيس التنفيذي"}</strong>
                    <span dir="ltr">@{profile.username}</span>
                  </div>
                </div>

                <div className="exec-account-key">
                  <span className="exec-account-key-label">
                    <KeyRound aria-hidden="true" />
                    كلمة الدخول
                  </span>
                  {pending ? (
                    <>
                      <code dir="ltr">{show ? record?.password_plain : "••••••••••••"}</code>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => toggleReveal(profile.id)}
                        aria-label={show ? "إخفاء" : "إظهار"}
                      >
                        {show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                      </button>
                    </>
                  ) : (
                    <span className="exec-account-owned">اختار الرئيس التنفيذي كلمته الخاصة</span>
                  )}
                </div>

                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy === profile.id}
                  onClick={() => void resetPassword(profile)}
                >
                  <RefreshCw aria-hidden="true" />
                  إصدار كلمة دخول جديدة
                </button>
              </article>
            );
          })
        )}
      </div>

      <form className="exec-account-form" onSubmit={(event) => void createExecutive(event)}>
        <label>
          <span>اسم المستخدم</span>
          <input
            dir="ltr"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="ceo"
            required
          />
        </label>
        <label>
          <span>الاسم</span>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            required
          />
        </label>
        <button className="primary-button" disabled={creating}>
          <Crown aria-hidden="true" />
          {creating ? "جاري الإنشاء..." : "إنشاء الحساب"}
        </button>
      </form>
    </section>
  );
}
