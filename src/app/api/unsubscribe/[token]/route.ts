import { jsonError } from "@/lib/http";
import { findRequestByUnsubscribeToken, unsubscribe } from "@/lib/requests";

/**
 * Stops the project's emails to this address (every request and campaign,
 * M9). Mail apps call this directly for one-click unsubscribe (RFC 8058);
 * the /u/:token page calls it from a button.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  // A campaign's test email carries placeholder links.
  if (token === "test") return Response.json({ ok: true, test: true });
  const r = findRequestByUnsubscribeToken(token);
  if (!r) return jsonError(404, "This link isn't valid");
  unsubscribe(r);
  return Response.json({ ok: true });
}
