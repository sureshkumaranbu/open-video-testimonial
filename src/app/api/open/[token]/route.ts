import { findRequestByOpenToken, markOpened } from "@/lib/requests";

/** A transparent 1×1 GIF. */
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/**
 * The open pixel (M9, REQ-04). It's only in emails of campaigns that turned
 * open tracking on, and markOpened checks that again. Only the time of the
 * first open is kept: no IP address, no user agent. Always answers the image.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const r = findRequestByOpenToken((await ctx.params).token);
  if (r) markOpened(r);
  return new Response(GIF, {
    headers: { "Content-Type": "image/gif", "Content-Length": String(GIF.length), "Cache-Control": "no-store, max-age=0" },
  });
}
