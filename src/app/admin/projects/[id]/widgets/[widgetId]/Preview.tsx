"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/app/admin/api";
import type { WidgetConfig, WidgetPayload } from "@/lib/widget-config";

type Mount = (host: HTMLElement, cfg: { base: string; preview: boolean }, data: WidgetPayload) => void;

declare global {
  interface Window {
    PlauditWidget?: { mount?: Mount };
  }
}

let loading: Promise<void> | null = null;

/**
 * Loads the real /widget.js once, in manual mode (it defines PlauditWidget and
 * draws nothing by itself). The dashboard's CSP trusts it because a trusted
 * script adds it ('strict-dynamic'), and its lazy layout files the same way.
 */
function loadWidgetJs(): Promise<void> {
  if (window.PlauditWidget?.mount) return Promise.resolve();
  if (!loading)
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/widget.js";
      s.dataset.mount = "manual";
      s.onload = () => resolve();
      s.onerror = () => {
        loading = null;
        reject(new Error("The widget script didn't load. Reload the page to try again."));
      };
      document.head.appendChild(s);
    });
  return loading;
}

type Props = { projectId: string; connectedFormId: string | null; config: WidgetConfig };

/**
 * The studio's live preview: the server builds the public payload for the
 * unsaved config (POST /api/admin/widgets/preview) and widget.js's own
 * mount() draws it, so the preview is exactly what an embed shows.
 */
export function WidgetPreview({ projectId, connectedFormId, config }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const body = JSON.stringify({ projectId, connectedFormId, config });

  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const [data] = await Promise.all([
          api<WidgetPayload>("/api/admin/widgets/preview", { method: "POST", json: JSON.parse(body) }),
          loadWidgetJs(),
        ]);
        const el = host.current;
        if (!live || !el || !window.PlauditWidget?.mount) return;
        el.removeAttribute("style");
        window.PlauditWidget.mount(el, { base: location.origin, preview: true }, data);
        setCount(data.testimonials.length);
        setError(null);
      } catch (err) {
        if (live) setError((err as Error).message);
      }
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [body]);

  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div ref={host} data-testid="widget-preview-host" data-plaudit-widget="preview" />
      <p className="visually-hidden" aria-live="polite">
        {count == null ? "" : `Preview shows ${count} testimonial${count === 1 ? "" : "s"}`}
      </p>
    </>
  );
}
