import { useEffect, useState } from "react";
import { LoadingState } from "../components/LoadingState";
import { SetupRequired } from "../components/SetupRequired";
import { isSetupError, supabase } from "../lib/supabase";

interface AppSetting {
  key: string;
  value: unknown;
  description: string | null;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!supabase) {
        return;
      }

      setLoading(true);
      const { data, error } = await supabase.from("app_settings").select("*").order("key");
      if (error) {
        if (isSetupError(error)) {
          setSetupError(error.message);
        }
      } else {
        setSettings((data as AppSetting[]) ?? []);
      }
      setLoading(false);
    }

    void load();
  }, []);

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
          <p>القيم المرجعية المطلوبة للتشغيل بدون بيانات تجريبية.</p>
        </div>
      </section>
      <div className="cards-list">
        {settings.map((setting) => (
          <article className="policy-card" key={setting.key}>
            <div>
              <h2>{setting.key}</h2>
              <p>{setting.description ?? "بدون وصف"}</p>
            </div>
            <code>{JSON.stringify(setting.value)}</code>
          </article>
        ))}
      </div>
    </div>
  );
}
