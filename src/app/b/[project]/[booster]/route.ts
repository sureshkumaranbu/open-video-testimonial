import { boosterDocument, boosterPath, getBoosterBySlug, viewOf } from "@/lib/boosters";
import { findProjectBySlugOrAlias } from "@/lib/projects";
import { absoluteUrl } from "@/lib/walls";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ project: string; booster: string }> };

const NOT_FOUND = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found</title><meta name="robots" content="noindex"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f6f7fb;color:#161b2e;padding:16px;text-align:center}</style></head><body><main><h1>This page isn't here</h1><p>The link may be old, or the page isn't public yet.</p></main></body></html>`;

/**
 * BOOST-01: the public review booster page. Plain HTML from one renderer
 * (no scripts, fonts or third-party requests), well under 50 KB. Every
 * visitor gets every link (BOOST-03). Drafts are a 404; old project and
 * booster links answer 308 with the query kept (D17), so printed QR codes
 * keep working.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { project: projectSlug, booster: boosterSlug } = await ctx.params;
  const found = findProjectBySlugOrAlias(projectSlug);
  const hit = found ? getBoosterBySlug(found.project.id, boosterSlug) : null;
  if (!found || !hit || !hit.booster.published) {
    return new Response(NOT_FOUND, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const own = boosterPath(found.project, hit.booster);
  if (!found.canonical || hit.redirectedFrom) {
    const search = new URL(req.url).search;
    return Response.redirect(absoluteUrl(`${own}${search}`), 308);
  }
  const html = boosterDocument(viewOf(found.project, hit.booster), { canonical: absoluteUrl(own) });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Short, so publishing, unpublishing and edits show quickly.
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
