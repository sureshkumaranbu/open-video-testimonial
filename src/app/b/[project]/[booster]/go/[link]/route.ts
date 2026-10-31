import { getBoosterBySlug, linkTarget, parseLinks, recordClick } from "@/lib/boosters";
import { featureOn } from "@/lib/features";
import { findProjectBySlugOrAlias } from "@/lib/projects";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ project: string; booster: string; link: string }> };

/** Clicks per visitor address in 10 minutes before the counter answers 429 (no person taps 60 review links that fast). */
const CLICKS_PER_WINDOW = 60;
const WINDOW_MS = 10 * 60 * 1000;

const plain = (status: number, text: string) => new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/**
 * BOOST-05: counts a click on one of a public booster's links, then sends
 * the person on. The target always comes from the stored link (by its id),
 * never from the request, so this can't be used as an open redirect. Only a
 * daily count per link is kept: no IPs, user agents or cookies. Rate-limited
 * per address; the limiter's key lives in memory only.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { project: projectSlug, booster: boosterSlug, link: linkId } = await ctx.params;
  const found = featureOn("booster") ? findProjectBySlugOrAlias(projectSlug) : null;
  const hit = found ? getBoosterBySlug(found.project.id, boosterSlug) : null;
  if (!found || !hit || !hit.booster.published) return plain(404, "Not found");
  const link = parseLinks(hit.booster.links).find((l) => l.id === linkId);
  const target = link ? linkTarget(found.project, link) : null;
  if (!link || !target) return plain(404, "Not found");
  if (!rateLimit(`booster-click:${clientKey(req)}`, CLICKS_PER_WINDOW, WINDOW_MS)) return plain(429, "Too many requests. Please try again in a few minutes.");
  recordClick(hit.booster.id, link.id);
  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store", "Referrer-Policy": "origin" } });
}
