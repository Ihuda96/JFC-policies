import { useEffect, useState } from "react";
import { Check, UserRoundCheck, X } from "lucide-react";
import { DEPARTMENT_UNITS, departmentName } from "../../lib/departments";
import { formatDate } from "../../lib/format";
import { errorMessage, supabase } from "../../lib/supabase";
import { useToast } from "../Toast";
import type { Profile } from "../../lib/types";

export function AdminSignupRequests({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const [requests, setRequests] = useState<Profile[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!supabase) {
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setRequests((data as Profile[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function approve(profile: Profile) {
    if (!supabase) return;
    const code = drafts[profile.id] ?? profile.department_code ?? "";
    if (!code) {
      toast.error("اختر الإدارة قبل الاعتماد.");
      return;
    }

    setBusy(profile.id);
    try {
      const { error } = await supabase.rpc("admin_approve_signup", {
        p_user_id: profile.id,
        p_department_code: code,
        p_department_label: departmentName(code),
        p_role: "department_staff",
      });
      if (error) throw error;
      toast.success("تم تفعيل الحساب.");
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function reject(profile: Profile) {
    if (!supabase) return;
    setBusy(profile.id);
    try {
      const { error } = await supabase.rpc("admin_reject_signup", {
        p_user_id: profile.id,
        p_reason: null,
      });
      if (error) throw error;
      toast.success("تم رفض الطلب.");
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return null;
  }

  return (
    <section className="data-section">
      <div className="section-title-row">
        <h2>طلبات الانضمام</h2>
        <span className="count-pill">{requests.length}</span>
      </div>

      {requests.length === 0 ? (
        <p className="chart-empty">لا توجد طلبات جديدة.</p>
      ) : (
        <div className="request-list">
          {requests.map((profile) => (
            <article className="request-card" key={profile.id}>
              <div className="request-main">
                <span className="request-avatar">
                  <UserRoundCheck aria-hidden="true" />
                </span>
                <div>
                  <strong>{profile.full_name ?? profile.username ?? "مستخدم جديد"}</strong>
                  <span className="request-meta">
                    {profile.username ? `@${profile.username}` : ""} · {formatDate(profile.created_at)}
                  </span>
                </div>
              </div>
              <label className="request-dept">
                <span>الإدارة</span>
                <select
                  value={drafts[profile.id] ?? profile.department_code ?? ""}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [profile.id]: event.target.value }))
                  }
                >
                  <option value="">اختر الإدارة</option>
                  {DEPARTMENT_UNITS.map((unit) => (
                    <option key={unit.code} value={unit.code}>
                      {unit.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="request-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy === profile.id}
                  onClick={() => void approve(profile)}
                >
                  <Check aria-hidden="true" />
                  اعتماد
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy === profile.id}
                  onClick={() => void reject(profile)}
                >
                  <X aria-hidden="true" />
                  رفض
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
