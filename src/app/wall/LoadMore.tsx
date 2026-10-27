"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { TestimonialCard, type CardDisplay } from "@/components/TestimonialCard";
import type { FeedItem } from "@/lib/widget-config";

type Props = {
  wallId: string;
  tab: number;
  nextOffset: number;
  infinite: boolean;
  display: CardDisplay;
  /** Cards already on the page. */
  shown: number;
  /** When the inline CTA hasn't been shown yet: after how many cards it goes. */
  ctaAfter: number | null;
  cta: ReactNode;
};

/**
 * WALL-01 "load more": the next page of a published wall's tab from
 * /api/walls/<id>/items. With infinite scroll the next page loads as the end
 * comes near; the button stays, so it works from the keyboard and without
 * IntersectionObserver.
 */
export function LoadMore({ wallId, tab, nextOffset, infinite, display, shown, ctaAfter, cta }: Props) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [next, setNext] = useState<number | null>(nextOffset);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (next == null || loading.current) return;
    loading.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/walls/${encodeURIComponent(wallId)}/items?tab=${tab}&offset=${next}`);
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as { items: FeedItem[]; nextOffset: number | null };
      setItems((x) => [...x, ...page.items.filter((p) => !x.some((i) => i.id === p.id))]);
      setNext(page.nextOffset);
    } catch {
      setError("Couldn’t load more. Try again.");
    } finally {
      loading.current = false;
      setBusy(false);
    }
  }, [next, tab, wallId]);

  useEffect(() => {
    const el = sentinel.current;
    if (!infinite || !el || next == null || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && load(), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [infinite, load, next]);

  return (
    <>
      {items.map((t, i) => (
        <WithCta key={t.id} cta={ctaAfter != null && shown + i + 1 === ctaAfter ? cta : null}>
          <TestimonialCard t={t} display={display} />
        </WithCta>
      ))}
      <div className="wl-span wl-more" ref={sentinel} aria-live="polite">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {next != null && (
          <button type="button" className="secondary" onClick={load} disabled={busy} data-testid="wall-load-more">
            {busy ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </>
  );
}

function WithCta({ children, cta }: { children: ReactNode; cta: ReactNode }) {
  return (
    <>
      {children}
      {cta && <div className="wl-span">{cta}</div>}
    </>
  );
}
