import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAppData } from "../context/AppDataContext";
import { formatDate } from "../lib/format";

export function ActionCenterPage() {
  const { actionGroups, actionCount, loading } = useAppData();

  if (loading) {
    return <LoadingState />;
  }

  return (
    <div className="page-stack">
      <section className="page-hero compact">
        <div>
          <p className="eyebrow">مركز المهام</p>
          <h1>ما يحتاج إجراء</h1>
          <p>كل ما ينتظر إجراءً منك في مكان واحد.</p>
        </div>
      </section>

      {actionCount === 0 ? (
        <div className="empty-state">
          <CheckCircle2 aria-hidden="true" />
          <h2>لا توجد مهام معلّقة</h2>
          <p>أنجزت كل ما يخصّك حاليًا.</p>
        </div>
      ) : (
        actionGroups.map((group) => (
          <section className="data-section" key={group.key}>
            <div className="section-title-row">
              <h2>{group.title}</h2>
              <span className="count-pill">{group.items.length}</span>
            </div>
            <div className="cards-list">
              {group.items.map((item) => (
                <Link className="action-row" to={item.to} key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    {item.meta ? <span>تاريخ المراجعة: {formatDate(item.meta)}</span> : null}
                  </div>
                  <ArrowLeft aria-hidden="true" />
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
