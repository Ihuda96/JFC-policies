import { FormEvent, useEffect, useState } from "react";
import { Save, UserPlus } from "lucide-react";
import { LoadingState } from "../components/LoadingState";
import { SetupRequired } from "../components/SetupRequired";
import { StatusBadge } from "../components/StatusBadge";
import { roleLabels } from "../lib/format";
import {
  createDetachedSupabaseClient,
  errorMessage,
  isSetupError,
  supabase,
} from "../lib/supabase";
import type { AppRole, Profile, ProfileStatus } from "../lib/types";

const roleOptions: Array<{ value: AppRole; label: string }> = [
  { value: "quality_staff", label: "موظف جودة" },
  { value: "quality_manager", label: "مدير جودة" },
  { value: "system_admin", label: "مدير نظام" },
];

const statusOptions: Array<{ value: ProfileStatus; label: string }> = [
  { value: "pending", label: "بانتظار التفعيل" },
  { value: "active", label: "نشط" },
  { value: "disabled", label: "معطل" },
];

function textValue(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export function AdminUsersPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  async function waitForProfile(userId: string) {
    if (!supabase) {
      return;
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const { data } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
      if (data) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  async function updateProfileRecord(userId: string, form: FormData, fallback: Profile) {
    if (!supabase) {
      return;
    }

    const { error: rpcError } = await supabase.rpc("admin_update_profile", {
      p_user_id: userId,
      p_username: textValue(form, "username"),
      p_full_name: textValue(form, "full_name"),
      p_role: (String(form.get("role") ?? fallback.role) || fallback.role) as AppRole,
      p_status: (String(form.get("status") ?? fallback.status) || fallback.status) as ProfileStatus,
      p_department: textValue(form, "department"),
      p_job_title: textValue(form, "job_title"),
      p_phone: textValue(form, "phone"),
    });

    if (rpcError) {
      throw rpcError;
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      return;
    }

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = textValue(form, "email").toLowerCase();
    const password = textValue(form, "password");
    const detachedClient = createDetachedSupabaseClient();

    if (!detachedClient) {
      setError("إعداد Supabase غير موجود.");
      return;
    }

    setCreating(true);
    setError(null);
    setNotice(null);

    try {
      const { data, error: signUpError } = await detachedClient.auth.signUp({
        email,
        password,
        options: {
          data: {
            username: textValue(form, "username"),
            full_name: textValue(form, "full_name"),
            department: textValue(form, "department"),
            job_title: textValue(form, "job_title"),
            phone: textValue(form, "phone"),
          },
        },
      });

      if (signUpError) {
        throw signUpError;
      }

      if (!data.user?.id) {
        throw new Error("لم يرجع Supabase معرف المستخدم. تأكد أن التسجيل مفعل وأن البريد غير مستخدم.");
      }

      await waitForProfile(data.user.id);
      await updateProfileRecord(data.user.id, form, {
        id: data.user.id,
        email,
        username: null,
        full_name: null,
        role: "quality_staff",
        status: "pending",
        department: null,
        job_title: null,
        phone: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await detachedClient.auth.signOut();
      formElement.reset();
      setNotice("تم إنشاء المستخدم وتحديث الدور والحالة.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function updateProfile(event: FormEvent<HTMLFormElement>, profile: Profile) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    setSaving(profile.id);
    setError(null);
    setNotice(null);

    try {
      await updateProfileRecord(profile.id, form, profile);
      setNotice("تم حفظ تغييرات المستخدم.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(null);
    }
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
            أنشئ مستخدمين ببيانات دخول، ثم حدّد الدور والحالة وبيانات العمل من نفس
            الصفحة. إنشاء الحساب يستخدم Supabase Auth بدون service role في المتصفح.
          </p>
        </div>
      </section>

      {error ? <p className="inline-error">{error}</p> : null}
      {notice ? <p className="inline-success">{notice}</p> : null}

      <form className="admin-create-card" onSubmit={(event) => void createUser(event)}>
        <div className="section-title-row">
          <div>
            <p className="eyebrow">مستخدم جديد</p>
            <h2>إضافة مستخدم باسم مستخدم وكلمة مرور</h2>
          </div>
        </div>
        <div className="admin-form-grid">
          <label>
            <span>البريد الإلكتروني</span>
            <input name="email" type="email" required autoComplete="off" />
          </label>
          <label>
            <span>اسم المستخدم</span>
            <input name="username" pattern="[a-zA-Z0-9._-]{3,32}" autoComplete="off" />
          </label>
          <label>
            <span>كلمة المرور</span>
            <input name="password" type="password" required minLength={8} autoComplete="new-password" />
          </label>
          <label>
            <span>الدور</span>
            <select name="role" defaultValue="quality_staff">
              {roleOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>الحالة</span>
            <select name="status" defaultValue="active">
              {statusOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>الاسم</span>
            <input name="full_name" autoComplete="off" />
          </label>
          <label>
            <span>الإدارة</span>
            <input name="department" autoComplete="off" />
          </label>
          <label>
            <span>المسمى</span>
            <input name="job_title" autoComplete="off" />
          </label>
          <label>
            <span>الجوال</span>
            <input name="phone" type="tel" autoComplete="off" />
          </label>
        </div>
        <button className="primary-button" disabled={creating}>
          <UserPlus aria-hidden="true" />
          {creating ? "جاري إنشاء المستخدم..." : "إنشاء المستخدم"}
        </button>
      </form>

      <div className="admin-user-list">
        {profiles.map((profile) => (
          <form
            className="admin-user-card"
            key={profile.id}
            onSubmit={(event) => void updateProfile(event, profile)}
          >
            <div>
              <StatusBadge status={profile.status} />
              <h2>{profile.email ?? profile.id}</h2>
              <p>{roleLabels[profile.role]}</p>
              {profile.username ? <p className="muted-line">@{profile.username}</p> : null}
            </div>
            <label>
              <span>اسم المستخدم</span>
              <input name="username" defaultValue={profile.username ?? ""} pattern="[a-zA-Z0-9._-]{3,32}" />
            </label>
            <label>
              <span>الاسم</span>
              <input name="full_name" defaultValue={profile.full_name ?? ""} />
            </label>
            <label>
              <span>الدور</span>
              <select name="role" defaultValue={profile.role}>
                {roleOptions.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>الحالة</span>
              <select name="status" defaultValue={profile.status}>
                {statusOptions.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
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
            <label>
              <span>الجوال</span>
              <input name="phone" type="tel" defaultValue={profile.phone ?? ""} />
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
