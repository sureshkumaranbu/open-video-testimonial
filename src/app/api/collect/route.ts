import { BEACON_HEADERS, pageBeaconResponse } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/**
 * WALL-05, FORM-15: views and clicks from walls and step-by-step forms, as a
 * small text/plain POST. The answer is always empty. Cookieless: see
 * docs/help/analytics.md.
 */
export async function POST(req: Request) {
  return pageBeaconResponse(req);
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...BEACON_HEADERS, "Access-Control-Allow-Methods": "POST, OPTIONS" } });
}
