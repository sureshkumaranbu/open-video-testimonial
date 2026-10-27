"use client";

import { useEffect, useState } from "react";
import { beacon } from "@/components/analytics/beacon";

/** Pages already counted on this load (React may run an effect twice). */
const counted = new Set<string>();

/**
 * WALL-04 analytics, the same cookieless beacon as walls (M11): one view per
 * page load, then clicks on the calls to action and the share links.
 */
export function TestimonialBeacon({ id }: { id: string }) {
  useEffect(() => {
    if (!counted.has(id)) {
      counted.add(id);
      beacon({ t: "testimonial", id, k: "view" });
    }
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-tp-click]");
      const k = el?.getAttribute("data-tp-click");
      if (k === "cta" || k === "share") beacon({ t: "testimonial", id, k });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [id]);
  return null;
}

/** "Copy link", with a spoken confirmation. Without a clipboard the link is selected for copying by hand. */
export function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <>
      <button
        type="button"
        className="tp-copy"
        data-tp-click="share"
        data-testid="share-copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setDone(true);
            setTimeout(() => setDone(false), 2500);
          } catch {
            window.prompt("Copy this link", url);
          }
        }}
      >
        {done ? "Link copied" : "Copy link"}
      </button>
      <span className="visually-hidden" role="status">
        {done ? "Link copied" : ""}
      </span>
    </>
  );
}
