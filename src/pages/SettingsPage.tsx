import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Camera, Save, ShieldPlus, Trash2 } from "lucide-react";
import { LoadingState } from "../components/LoadingState";
import { SetupRequired } from "../components/SetupRequired";
import { UserAvatar } from "../components/UserAvatar";
import { useToast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { canAdminister, isSuperAdmin } from "../lib/permissions";
import { toPngBlob } from "../lib/stamp";
import { errorMessage, isSetupError, supabase } from "../lib/supabase";

const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

interface AppSetting {
  key: string;
  value: unknown;
  description: string | null;
}

interface SystemAdminOverride {
  email: string;
  is_active: boolean;
  note: string | null;
}

function parseJsonValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return JSON.parse(trimmed);
}

function formText(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export function SettingsPage() {
  const { profile, refreshProfile } = useAuth();
  const toast = useToast();
  const isSystemAdmin = canAdminister(profile);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [settings, setSettings] = useState<AppSetting[]>([]);
  const [adminOverrides, setAdminOverrides] = useState<SystemAdminOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) {
      return;
    }

    setLoading(true);
    setError(null);

    const settingsResult = await supabase.from("app_settings").select("*").order("key");

    if (settingsResult.error) {
      if (isSetupError(settingsResult.error)) {
        setSetupError(settingsResult.error.message);
      } else {
        setError(settingsResult.error.message);
      }
    } else {
      setSettings((settingsResult.data as AppSetting[]) ?? []);
    }

    if (isSystemAdmin) {
      const overridesResult = await supabase
        .from("system_admin_overrides")
        .select("email,is_active,note")
        .order("email");

      if (overridesResult.error) {
        if (isSetupError(overridesResult.error)) {
          setSetupError(overridesResult.error.message);
        } else {
          setError(overridesResult.error.message);
        }
      } else {
        setAdminOverrides((overridesResult.data as SystemAdminOverride[]) ?? []);
      }
    }

    setLoading(false);
  }, [isSystemAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSetting(event: FormEvent<HTMLFormElement>, existingKey?: string) {
    event.preventDefault();
    if (!supabase) {
      return;
    }

    const form = new FormData(event.currentTarget);
    const key = existingKey ?? formText(form, "key");
    setSaving(key);
    setError(null);
    setNotice(null);

    try {
      const value = parseJsonValue(formText(form, "value"));
      const { error: upsertError } = await supabase.from("app_settings").upsert({
        key,
        value,
        description: formText(form, "description") || null,
      });

      if (upsertError) {
        throw upsertError;
      }

      setNotice("تم حفظ الإعداد.");
      if (!existingKey) {
        event.currentTarget.reset();
      }
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  async function saveOverride(event: FormEvent<HTMLFormElement>, existingEmail?: string) {
    event.preventDefault();
    if (!supabase) {
      return;
    }

    const form = new FormData(event.currentTarget);
    const email = (existingEmail ?? formText(form, "email")).toLowerCase();
    setSaving(email);
    setError(null);
    setNotice(null);

    try {
      const { error: upsertError } = await supabase.from("system_admin_overrides").upsert({
        email,
        is_active: form.get("is_active") === "true",
        note: formText(form, "note") || null,
      });

      if (upsertError) {
        throw upsertError;
      }

      setNotice("تم حفظ صلاحية الاستثناء.");
      if (!existingEmail) {
        event.currentTarget.reset();
      }
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  async function uploadAvatar(file: File) {
    if (!supabase || !profile) return;

    if (!AVATAR_TYPES.has(file.type)) {
      toast.error("صيغ الصورة المسموحة: PNG أو JPEG أو WebP.");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error("حجم الصورة يجب ألا يتجاوز 2 ميجابايت.");
      return;
    }

    setUploadingAvatar(true);
    try {
      const pngBlob = await toPngBlob(file);
      const path = `${profile.id}/avatar-${Date.now()}.png`;

      const { error: uploadError } = await supabase.storage
        .from("profile-avatars")
        .upload(path, pngBlob, { contentType: "image/png", upsert: false });
      if (uploadError) throw uploadError;

      const { error: rpcError } = await supabase.rpc("set_profile_avatar", {
        p_storage_path: path,
      });
      if (rpcError) throw rpcError;

      await refreshProfile();
      toast.success("تم تحديث صورتك الشخصية.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function removeAvatar() {
    if (!supabase) return;

    setUploadingAvatar(true);
    try {
      const { error: rpcError } = await supabase.rpc("clear_profile_avatar");
      if (rpcError) throw rpcError;

      await refreshProfile();
      toast.success("أُزيلت صورتك الشخصية، وستظهر شارة التجمع بدلًا منها.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploadingAvatar(false);
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
          <p className="eyebrow">إعدادات تشغيلية</p>
          <h1>الإعدادات</h1>
          <p>
            إدارة القيم المرجعية، صلاحيات الاسترجاع، وبعض خيارات التشغيل من داخل
            الموقع. تُحفظ التغييرات فورًا وتُطبّق على المنصة مباشرة.
          </p>
        </div>
      </section>

      {error ? <p className="inline-error">{error}</p> : null}
      {notice ? <p className="inline-success">{notice}</p> : null}

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Personal</p>
            <h2>الملف الشخصي</h2>
          </div>
        </div>

        <div className="avatar-settings-row">
          <UserAvatar profile={profile} isSuperAdmin={isSuperAdmin(profile)} className="avatar-settings-preview" />
          <div>
            <strong>{profile?.full_name ?? "مستخدم"}</strong>
            <p>
              ارفع صورة شخصية تظهر بدلًا من شارة التجمع الافتراضية في كل مكان
              باسمك. الصيغ المسموحة: PNG أو JPEG أو WebP، بحد أقصى 2 ميجابايت.
            </p>
            <div className="avatar-settings-actions">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void uploadAvatar(file);
                }}
              />
              <button
                type="button"
                className="secondary-button"
                disabled={uploadingAvatar}
                onClick={() => avatarInputRef.current?.click()}
              >
                <Camera aria-hidden="true" />
                {profile?.avatar_path ? "تغيير الصورة" : "رفع صورة"}
              </button>
              {profile?.avatar_path ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={uploadingAvatar}
                  onClick={() => void removeAvatar()}
                >
                  <Trash2 aria-hidden="true" />
                  إزالة الصورة
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {isSystemAdmin ? (
      <section className="data-section">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">System administrators</p>
            <h2>استثناءات مدير النظام</h2>
          </div>
        </div>

        <form className="settings-form" onSubmit={(event) => void saveOverride(event)}>
          <label>
            <span>البريد الإلكتروني</span>
            <input name="email" type="email" required />
          </label>
          <label>
            <span>الحالة</span>
            <select name="is_active" defaultValue="true">
              <option value="true">نشط</option>
              <option value="false">معطل</option>
            </select>
          </label>
          <label>
            <span>ملاحظة</span>
            <input name="note" />
          </label>
          <button className="primary-button" disabled={saving === "new-override"}>
            <ShieldPlus aria-hidden="true" />
            إضافة استثناء
          </button>
        </form>

        <div className="cards-list">
          {adminOverrides.map((override) => (
            <form
              className="policy-card settings-card"
              key={override.email}
              onSubmit={(event) => void saveOverride(event, override.email)}
            >
              <div>
                <h2>{override.email}</h2>
                <p>{override.note ?? "بدون ملاحظة"}</p>
              </div>
              <label>
                <span>الحالة</span>
                <select name="is_active" defaultValue={String(override.is_active)}>
                  <option value="true">نشط</option>
                  <option value="false">معطل</option>
                </select>
              </label>
              <label>
                <span>ملاحظة</span>
                <input name="note" defaultValue={override.note ?? ""} />
              </label>
              <button className="secondary-button" disabled={saving === override.email}>
                <Save aria-hidden="true" />
                حفظ
              </button>
            </form>
          ))}
        </div>
      </section>
      ) : null}

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Application settings</p>
            <h2>القيم المرجعية</h2>
          </div>
        </div>

        {isSystemAdmin ? (
        <form className="settings-form" onSubmit={(event) => void saveSetting(event)}>
          <label>
            <span>المفتاح</span>
            <input name="key" required pattern="[a-z0-9_\\-]+" />
          </label>
          <label>
            <span>القيمة JSON</span>
            <textarea name="value" required defaultValue="null" />
          </label>
          <label>
            <span>الوصف</span>
            <input name="description" />
          </label>
          <button className="primary-button">
            <Save aria-hidden="true" />
            إضافة إعداد
          </button>
        </form>
        ) : null}

        <div className="cards-list">
          {settings.map((setting) =>
            isSystemAdmin ? (
              <form
                className="policy-card settings-card"
                key={setting.key}
                onSubmit={(event) => void saveSetting(event, setting.key)}
              >
                <div>
                  <h2>{setting.key}</h2>
                  <p>{setting.description ?? "بدون وصف"}</p>
                </div>
                <label>
                  <span>القيمة JSON</span>
                  <textarea name="value" defaultValue={JSON.stringify(setting.value, null, 2)} />
                </label>
                <label>
                  <span>الوصف</span>
                  <input name="description" defaultValue={setting.description ?? ""} />
                </label>
                <button className="secondary-button" disabled={saving === setting.key}>
                  <Save aria-hidden="true" />
                  حفظ
                </button>
              </form>
            ) : (
              <article className="policy-card" key={setting.key}>
                <div>
                  <h2>{setting.key}</h2>
                  <p>{setting.description ?? "بدون وصف"}</p>
                </div>
                <code>{JSON.stringify(setting.value)}</code>
              </article>
            ),
          )}
        </div>
      </section>
    </div>
  );
}
