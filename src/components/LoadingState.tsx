function PageSkeleton() {
  return (
    <div className="page-stack skeleton-screen" aria-hidden="true">
      <div className="skeleton sk-hero" />
      <div className="sk-grid">
        <div className="skeleton sk-tile" />
        <div className="skeleton sk-tile" />
        <div className="skeleton sk-tile" />
        <div className="skeleton sk-tile" />
      </div>
      <div className="skeleton sk-block" />
      <div className="skeleton sk-block sk-block-sm" />
    </div>
  );
}

export function LoadingState({
  label = "جاري التحميل...",
  inline = false,
}: {
  label?: string;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <div className="loading-state" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span>{label}</span>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <PageSkeleton />
    </div>
  );
}
