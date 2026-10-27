import { widgetHtmlUrl } from "./embed.js";

/*
 * Kept apart from the components (which are "use client"), so a React
 * server component can call it.
 */

/**
 * Fetches a widget's server-rendered HTML for SEO mode, on your server (a
 * Next.js server component, getServerSideProps, a static build). Plaudit
 * caches it for 60 seconds; pass `init` for your framework's own caching,
 * e.g. `{ next: { revalidate: 300 } }`. Answers "" when anything goes wrong,
 * so the live widget still shows.
 */
export async function fetchWidgetHtml(server: string, id: string, o: { jsonLd?: boolean; init?: RequestInit; timeoutMs?: number } = {}): Promise<string> {
  const url = widgetHtmlUrl(server, id, o);
  if (!url) return "";
  try {
    const res = await fetch(url, { ...o.init, signal: AbortSignal.timeout(o.timeoutMs ?? 5000) });
    return res.ok ? await res.text() : "";
  } catch {
    return "";
  }
}
