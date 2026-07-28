/** Small persistent credit shown in a corner of every page. Non-interactive
 *  (pointer-events: none in CSS) so it can never intercept a click meant for
 *  the page underneath, regardless of what's rendered there. */
export function PoweredBy() {
  return (
    <div className="powered-by" aria-hidden="true">
      <span className="powered-by-label">Powered by</span>
      <span className="powered-by-name">HudaJuhany</span>
    </div>
  );
}
