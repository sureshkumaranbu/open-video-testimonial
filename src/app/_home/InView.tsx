"use client";

import { useEffect } from "react";

/**
 * Marks `[data-reveal]` elements while they're on screen: `data-inview`
 * comes and goes (looping vignettes pause off screen) and the `is-in` class
 * stays once set (one-shot sequences don't replay). The animations only run
 * on a `.motion-ok` page (boot.ts); otherwise everything shows its final
 * state and this marks them all at once.
 */
export function InView() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const motion = document.getElementById("home-root")?.classList.contains("motion-ok");
    if (!motion || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (e.isIntersecting) {
            el.dataset.inview = "";
            el.classList.add("is-in");
          } else delete el.dataset.inview;
        }
      },
      { threshold: 0.35 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
