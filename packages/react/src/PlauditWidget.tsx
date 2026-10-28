"use client";

import { type CSSProperties, useEffect, useId } from "react";
import { domId, widgetScript } from "./embed.js";

export type PlauditWidgetProps = {
  /** Your Plaudit server, e.g. "https://plaudit.example.com". */
  server: string;
  /** The saved widget's id, w_ and 12 letters or digits (Widgets › your widget › Share). */
  id: string;
  /**
   * SEO mode: the widget's server-rendered HTML from fetchWidgetHtml() (./html), fetched
   * on your server. It's in the page for search engines and readers without
   * JavaScript; the live widget then draws over it in its own shadow root.
   */
  html?: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * A saved Plaudit widget. On the server it renders only its placeholder (or
 * the SEO HTML); in the browser it adds widget.js, which draws the widget
 * into that placeholder. Changing `id` mounts a fresh one.
 */
export function PlauditWidget({ server, id, html, className, style }: PlauditWidgetProps) {
  const target = domId("plaudit", useId());
  useEffect(() => {
    const attrs = widgetScript(server, id, target);
    if (!attrs) {
      console.warn(`[plaudit] PlauditWidget needs a server address and a widget id like w_abc123def456 (got ${JSON.stringify(id)})`);
      return;
    }
    const s = document.createElement("script");
    s.src = attrs.src;
    s.async = true;
    s.dataset.widget = attrs.widget;
    s.dataset.target = attrs.target;
    document.body.appendChild(s);
    return () => s.remove();
  }, [server, id, target]);
  return (
    <div
      key={id}
      id={target}
      className={className}
      style={style}
      data-plaudit-widget={id}
      {...(html ? { dangerouslySetInnerHTML: { __html: html } } : {})}
    />
  );
}
