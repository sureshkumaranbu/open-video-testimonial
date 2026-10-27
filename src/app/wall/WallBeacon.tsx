"use client";

import { useEffect } from "react";
import { beacon } from "@/components/analytics/beacon";

/** Walls already counted on this page load (React may run an effect twice). */
const counted = new Set<string>();

/**
 * WALL-05: one view per page load, then clicks on the calls to action (hero
 * and inline) and on other links (logo, header links, original reviews).
 * Tabs and "Load more" stay on the wall, so they aren't clicks out.
 */
export function WallBeacon({ wallId }: { wallId: string }) {
  useEffect(() => {
    if (!counted.has(wallId)) {
      counted.add(wallId);
      beacon({ t: "wall", id: wallId, k: "view" });
    }
    const page = [...document.querySelectorAll<HTMLElement>("[data-wall-id]")].find((el) => el.dataset.wallId === wallId);
    if (!page) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!a || !page.contains(a) || a.classList.contains("wl-tab")) return;
      beacon({ t: "wall", id: wallId, k: a.matches(".wl-cta, .wl-inline-cta a") ? "cta" : "link" });
    };
    page.addEventListener("click", onClick);
    return () => page.removeEventListener("click", onClick);
  }, [wallId]);
  return null;
}
