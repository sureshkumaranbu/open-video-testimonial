/**
 * The addresses and attributes the components use, kept free of React so
 * they're easy to test and reuse. Everything here only builds strings; the
 * components decide when the browser loads them.
 */

/** A saved widget's id, as the dashboard shows it. */
export const WIDGET_ID = /^w_[a-z0-9]{12}$/;

/** The Plaudit server's origin from what the app passed: http(s) only, no trailing slash. Null when it isn't a usable address. */
export function serverOrigin(server: string): string | null {
  try {
    const url = new URL(server);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** What widget.js needs on its script tag: the source, the widget and the element to draw into. */
export function widgetScript(server: string, id: string, target: string) {
  const origin = serverOrigin(server);
  if (!origin || !WIDGET_ID.test(id)) return null;
  return { src: `${origin}/widget.js`, widget: id, target: `#${target}` };
}

/** The server-rendered HTML of a widget, for search engines (the SEO include). */
export function widgetHtmlUrl(server: string, id: string, o: { jsonLd?: boolean } = {}) {
  const origin = serverOrigin(server);
  if (!origin || !WIDGET_ID.test(id)) return null;
  return `${origin}/api/widget/${id}/html${o.jsonLd ? "?jsonld=1" : ""}`;
}

/** The form's iframe address, with optional prefill and hidden fields (?name=, ?utm_source=…) in the query. */
export function formFrameUrl(server: string, project: string, form: string, params?: Record<string, string | number | undefined>) {
  const origin = serverOrigin(server);
  if (!origin || !project || !form) return null;
  const url = new URL(`${origin}/embed/${encodeURIComponent(project)}/form/${encodeURIComponent(form)}`);
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  return url.toString();
}

/** A DOM id safe in a CSS selector, from React's useId() (which has characters a selector can't take). */
export function domId(prefix: string, reactId: string) {
  return `${prefix}-${reactId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

/** What the embedded form posts to the page around it (docs/EMBED.md). */
export type FormMessage =
  | { type: "plaudit:form-resize"; form: string; slug: string; height: number }
  | { type: "plaudit:form-submitted"; form: string; slug: string }
  | { type: "plaudit:form-close"; form: string; slug: string };

/** A message from the form's frame, or null for anything else: only from the Plaudit server's origin, about this form. */
export function readFormMessage(e: { origin: string; data: unknown }, server: string, form: string): FormMessage | null {
  const origin = serverOrigin(server);
  if (!origin || e.origin !== new URL(origin).origin) return null;
  const d = e.data as Partial<FormMessage> | null;
  if (!d || typeof d !== "object" || typeof d.type !== "string" || !d.type.startsWith("plaudit:form-")) return null;
  if (d.slug !== form && d.form !== form) return null;
  if (d.type === "plaudit:form-resize" && !(typeof d.height === "number" && d.height > 0 && d.height < 20_000)) return null;
  return d as FormMessage;
}
