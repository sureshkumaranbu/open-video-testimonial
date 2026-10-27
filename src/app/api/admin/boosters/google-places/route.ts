import { z } from "zod";
import { googleReviewUrl } from "@/lib/booster-config";
import { PlacesError, searchPlaces } from "@/lib/google-places";
import { jsonError, requireAdmin } from "@/lib/http";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { firstIssue } from "@/lib/validation";

const body = z.object({ query: z.string().max(200) });

/**
 * BOOST-02: finds a business with Google's Places API, from this server only
 * (the key never reaches the browser), and returns each hit's review link.
 * 409 when GOOGLE_PLACES_API_KEY isn't set. 20 searches a minute.
 */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  if (!rateLimit(`places-search:${clientKey(req)}`, 20, 60_000)) return jsonError(429, "Too many searches. Wait a minute and try again.");
  try {
    const places = await searchPlaces(parsed.data.query);
    return Response.json({ places: places.map((p) => ({ ...p, reviewUrl: googleReviewUrl(p.placeId) })) });
  } catch (err) {
    if (err instanceof PlacesError) return jsonError(err.status, err.message);
    throw err;
  }
}
