import { BEACON_HEADERS, widgetBeaconResponse } from "@/lib/analytics";
import { WIDGET_ID } from "@/lib/widgets";

export const dynamic = "force-dynamic";

/**
 * DISP-13, DISP-14: widget.js reports a view (once per page load) or a click
 * here. A text/plain POST with no custom headers, so it needs no preflight;
 * the answer is always empty. Cookieless: see docs/help/analytics.md.
 */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!WIDGET_ID.test(slug)) return new Response(null, { status: 204, headers: BEACON_HEADERS });
  return widgetBeaconResponse(req, slug);
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...BEACON_HEADERS, "Access-Control-Allow-Methods": "POST, OPTIONS" } });
}
