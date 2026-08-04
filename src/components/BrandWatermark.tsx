/** Faded cluster emblem, fixed behind every page's content. Purely
 *  decorative (pointer-events: none, negative z-index) so ordinary page
 *  backgrounds always paint over it — it only shows through wherever a
 *  page leaves its own background exposed. */
export function BrandWatermark() {
  return <div className="brand-watermark" aria-hidden="true" />;
}
