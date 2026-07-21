import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppData } from "../context/AppDataContext";
import { formatDate } from "../lib/format";
import { markNotificationRead } from "../lib/policyWorkflow";

export function NotificationBell() {
  const { notifications, unreadCount, refresh } = useAppData();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function openItem(id: string, actionUrl: string | null, unread: boolean) {
    setOpen(false);
    if (unread) {
      try {
        await markNotificationRead(id);
        await refresh();
      } catch {
        // ignore
      }
    }
    if (actionUrl) {
      navigate(actionUrl);
    } else {
      navigate("/app/notifications");
    }
  }

  return (
    <div className="bell" ref={ref}>
      <button
        type="button"
        className="icon-button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`الإشعارات${unreadCount ? ` (${unreadCount} غير مقروء)` : ""}`}
      >
        <Bell aria-hidden="true" />
        {unreadCount > 0 ? <span className="bell-badge">{unreadCount}</span> : null}
      </button>
      {open ? (
        <div className="bell-menu">
          <header>
            <strong>الإشعارات</strong>
            <button type="button" onClick={() => { setOpen(false); navigate("/app/notifications"); }}>
              عرض الكل
            </button>
          </header>
          <div className="bell-list">
            {notifications.length === 0 ? (
              <p className="bell-empty">لا توجد إشعارات.</p>
            ) : (
              notifications.slice(0, 8).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={item.read_at ? "bell-item" : "bell-item unread"}
                  onClick={() => void openItem(item.id, item.action_url, !item.read_at)}
                >
                  <strong>{item.title_ar}</strong>
                  <span>{item.body_ar}</span>
                  <em>{formatDate(item.created_at)}</em>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
