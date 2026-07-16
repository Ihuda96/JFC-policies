import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { SetupRequired } from "../components/SetupRequired";
import { formatDate } from "../lib/format";
import { markNotificationRead, readableWorkflowError } from "../lib/policyWorkflow";
import { isSetupError, supabase } from "../lib/supabase";
import type { NotificationItem } from "../lib/types";

export function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!supabase) {
      return;
    }

    setLoading(true);
    const { data, error: queryError } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false });

    if (queryError) {
      if (isSetupError(queryError)) {
        setSetupError(queryError.message);
      } else {
        setError(queryError.message);
      }
    } else {
      setItems((data as NotificationItem[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function markRead(id: string) {
    try {
      await markNotificationRead(id);
      await load();
    } catch (err) {
      setError(readableWorkflowError(err));
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
          <p className="eyebrow">مركز الإشعارات</p>
          <h1>الإشعارات</h1>
          <p>كل إشعار مرتبط بإجراء مباشر أو سياسة محددة.</p>
        </div>
      </section>
      {error ? <p className="inline-error">{error}</p> : null}
      <div className="cards-list">
        {items.map((item) => (
          <article className={`notification-card ${item.read_at ? "read" : ""}`} key={item.id}>
            <div>
              <h2>{item.title_ar}</h2>
              <p>{item.body_ar}</p>
              <span>{formatDate(item.created_at)}</span>
            </div>
            <div className="notification-actions">
              {item.action_url ? <Link to={item.action_url}>فتح</Link> : null}
              {!item.read_at ? (
                <button onClick={() => void markRead(item.id)}>تعليم كمقروء</button>
              ) : null}
            </div>
          </article>
        ))}
        {items.length === 0 ? <p>لا توجد إشعارات.</p> : null}
      </div>
    </div>
  );
}
