import { useEffect, useRef } from "react";

/**
 * Mirrors the design system's own reveal/stagger observer:
 * threshold 0.12, rootMargin "0px 0px -8% 0px", adds .in once and stops
 * watching. Respects prefers-reduced-motion by doing nothing extra — the
 * CSS itself collapses the transition to a plain ≤120ms fade in that case.
 *
 * IntersectionObserver's first callback can miss content that's already on
 * screen at mount — mobile viewport sizing and web-font reflow can both
 * shift things after the observer takes its initial snapshot, and it only
 * re-checks on the next real intersection change, not on a layout shift. A
 * missed first hit means the target never gets .in and stays invisible
 * forever, which is unacceptable for content that's supposed to be visible
 * immediately. A hard timeout guarantees every element becomes visible
 * shortly after mount even if the observer never reports it as intersecting.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reveal = () => node.classList.add("in");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            reveal();
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    observer.observe(node);
    const fallback = window.setTimeout(reveal, 800);

    return () => {
      observer.disconnect();
      window.clearTimeout(fallback);
    };
  }, []);

  return ref;
}
