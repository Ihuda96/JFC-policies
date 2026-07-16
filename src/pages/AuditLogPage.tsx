import { useEffect, useState } from "react";
import { LoadingState } from "../components/LoadingState";
import { SetupRequired } from "../components/SetupRequired";
import { formatDate } from "../lib/format";
import { isSetupError, supabase } from "../lib/supabase";
import type { AuditLog } from "../lib/types";

export function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!supabase) {
        return;
      }

      setLoading(true);
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("event_time", { ascending: false })
        .limit(200);

      if (error) {
        if (isSetupError(error)) {
          setSetupError(error.message);
        }
      } else {
        setLogs((data as AuditLog[]) ?? []);
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
          <p className="eyebrow">غير قابل للتعديل من الواجهة</p>
          <h1>سجل العمليات</h1>
          <p>يعرض آخر 200 حدث تسمح بها الصلاحيات.</p>
        </div>
      </section>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>الوقت</th>
              <th>الحدث</th>
              <th>الكيان</th>
              <th>التفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{formatDate(log.event_time)}</td>
                <td>{log.event_type}</td>
                <td>{log.entity_table ?? "-"}</td>
                <td><code>{JSON.stringify(log.metadata ?? {})}</code></td>
              </tr>
            ))}
            {logs.length === 0 ? (
              <tr>
                <td colSpan={4}>لا توجد أحداث.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
