"use client";

import { useEffect } from "react";

/**
 * Page-level motion for the home page: reveals `[data-reveal]` elements as
 * they scroll into view, shrinks the nav, drives the scroll-progress bar and
 * applies gentle parallax to `[data-parallax]` (transform only). With
 * prefers-reduced-motion everything is shown immediately and nothing moves.
 */
export function HomeMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".home");
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const revealables = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));

    if (reduce || !("IntersectionObserver" in window)) {
      root.classList.remove("motion-ready");
      revealables.forEach((el) => el.classList.add("is-in"));
    } else {
      root.classList.add("motion-ready");
    }

    const io =
      !reduce && "IntersectionObserver" in window
        ? new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (entry.isIntersecting) {
                  entry.target.classList.add("is-in");
                  io?.unobserve(entry.target);
                }
              }
            },
            { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
          )
        : null;
    revealables.forEach((el) => io?.observe(el));

    const parallax = reduce ? [] : Array.from(document.querySelectorAll<HTMLElement>("[data-parallax]"));
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      root.style.setProperty("--scroll-progress", String(max > 0 ? Math.min(y / max, 1) : 0));
      root.toggleAttribute("data-scrolled", y > 24);
      for (const el of parallax) {
        el.style.setProperty("--py", `${(-y * Number(el.dataset.parallax || 0.1)).toFixed(1)}px`);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      io?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
      root.removeAttribute("data-scrolled");
      root.classList.remove("motion-ready");
    };
  }, []);

  return null;
}

/**
 * Runs before first paint (as the first child of `.home`): hides reveal targets only when motion is allowed
 * and JS is running, so content never disappears for no-JS or reduced-motion
 * visitors.
 */
export const MOTION_BOOT = `(function(){try{if(!matchMedia("(prefers-reduced-motion: reduce)").matches&&"IntersectionObserver" in window){document.currentScript.parentElement.classList.add("motion-ready")}}catch(e){}})();`;
