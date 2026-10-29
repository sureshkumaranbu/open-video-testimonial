import { env } from "@/lib/env";
import { CORS_HEADERS } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { renderWidgetHtml } from "@/lib/widget-html";
import { getWidget, WIDGET_ID, widgetConfig, widgetPayload } from "@/lib/widgets";

const HTML_HEADERS = {
  ...CORS_HEADERS,
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
};

/**
 * DISP-10: the widget as server-rendered HTML to include into a page, so its
 * review text is there with JavaScript off. `?jsonld=1` adds schema.org data.
 * A deleted widget gives an empty fragment, so an include never breaks a page.
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const w = WIDGET_ID.test(slug) ? getWidget(slug) : null;
  const project = w && getProjectById(w.projectId);
  if (!w || !project) return new Response("<!-- Plaudit: widget not found -->", { status: 404, headers: HTML_HEADERS });
  if (w.deletedAt) return new Response("", { headers: HTML_HEADERS });
  const payload = widgetPayload(project, w, widgetConfig(w));
  const jsonLd = new URL(req.url).searchParams.get("jsonld") === "1";
  // A sales popup's purchases (INT-07) aren't reviews: never in the HTML or its schema.org data.
  const items = payload.testimonials.filter((t) => !t.sale);
  const html = renderWidgetHtml(payload.widget!, payload.project!, items, payload.aggregate, { jsonLd, origin: env.publicUrl });
  return new Response(html, { headers: HTML_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
