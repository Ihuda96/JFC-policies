import { useEffect, useRef } from "react";

/**
 * Mirrors the design system's own reveal/stagger observer:
 * threshold 0.12, rootMargin "0px 0px -8% 0px", adds .in once and stops
 * watching. Respects prefers-reduced-motion by doing nothing extra — the
 * CSS itself collapses the transition to a plain ≤120ms fade in that case.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return ref;
}
