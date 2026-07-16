import { FormEvent, useEffect, useState } from "react";
import { Save } from "lucide-react";
import { LoadingState } from "../components/LoadingState";
import { SetupRequired } from "../components/SetupRequired";
import { StatusBadge } from "../components/StatusBadge";
import { roleLabels } from "../lib/format";
import { errorMessage, isSetupError, supabase } from "../lib/supabase";
import type { AppRole, Profile, ProfileStatus } from "../lib/types";

export function AdminUsersPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    if (!supabase) {
      return;
    }

    setLoading(true);
    const { data, error: queryError } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (queryError) {
      if (isSetupError(queryError)) {
        setSetupError(queryError.message);
      } else {
        setError(queryError.message);
      }
    } else {
      setProfiles((data as Profile[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function updateProfile(event: FormEvent<HTMLFormElement>, profile: Profile) {
    event.preventDefault();
    if (!supabase) {
      return;
    }

    const form = new FormData(event.currentTarget);
    setSaving(profile.id);
    setError(null);
    const { error: rpcError } = await supabase.rpc("admin_update_profile", {
      p_user_id: profile.id,
      p_full_name: String(form.get("full_name") ?? ""),
      p_role: String(form.get("role") ?? profile.role) as AppRole,
      p_status: String(form.get("status") ?? profile.status) as ProfileStatus,
      p_department: String(form.get("department") ?? ""),
      p_job_title: String(form.get("job_title") ?? ""),
    });

    if (rpcError) {
      setError(errorMessage(rpcError));
    } else {
      await load();
    }
    setSaving(null);
  }

  if (setupError) {
    return <SetupRequired message={setupError} />;
  }

  if (loading) {
    return <LoadingState />;
  }

  return (
    <div className="page-stack">
      <section className="page-hero compact">
        <div>
          <p className="eyebrow">مدير النظام</p>
          <h1>المستخدمون والأدوار</h1>
          <p>
            أنشئ حساب المستخدم أولًا من Supabase Auth، ثم فعّل ملفه وحدد الدور من
            هنا. لا يستخدم التطبيق service role في المتصفح.
          </p>
        </div>
      </section>
      {error ? <p className="inline-error">{error}</p> : null}
      <div className="admin-user-list">
        {profiles.map((profile) => (
          <form className="admin-user-card" key={profile.id} onSubmit={(event) => void updateProfile(event, profile)}>
            <div>
              <StatusBadge status={profile.status} />
              <h2>{profile.email ?? profile.id}</h2>
              <p>{roleLabels[profile.role]}</p>
            </div>
            <label>
              <span>الاسم</span>
              <input name="full_name" defaultValue={profile.full_name ?? ""} />
            </label>
            <label>
              <span>الدور</span>
              <select name="role" defaultValue={profile.role}>
                <option value="quality_staff">موظف جودة</option>
                <option value="quality_manager">مدير جودة</option>
                <option value="system_admin">مدير نظام</option>
              </select>
            </label>
            <label>
              <span>الحالة</span>
              <select name="status" defaultValue={profile.status}>
                <option value="pending">بانتظار التفعيل</option>
                <option value="active">نشط</option>
                <option value="disabled">معطل</option>
              </select>
            </label>
            <label>
              <span>الإدارة</span>
              <input name="department" defaultValue={profile.department ?? ""} />
            </label>
            <label>
              <span>المسمى</span>
              <input name="job_title" defaultValue={profile.job_title ?? ""} />
            </label>
            <button className="primary-button" disabled={saving === profile.id}>
              <Save aria-hidden="true" />
              {saving === profile.id ? "جاري الحفظ..." : "حفظ"}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
