import { jsonError } from "@/lib/http";
import { findRequestByUnsubscribeToken, unsubscribe } from "@/lib/requests";

/**
 * Stops emails for one request. Mail apps call this directly for one-click
 * unsubscribe (RFC 8058); the /u/:token page calls it from a button.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const r = findRequestByUnsubscribeToken((await ctx.params).token);
  if (!r) return jsonError(404, "This link isn't valid");
  unsubscribe(r);
  return Response.json({ ok: true });
}
