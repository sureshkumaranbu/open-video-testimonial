import { getRequestSession } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/http";
import { getInboxPrefs, inboxCounts, inboxFacets, inboxStats, parseInboxParams, queryTestimonials } from "@/lib/inbox";
import { getProjectById } from "@/lib/testimonials";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One page of the inbox (INBOX-01..05): `?tab=&q=&rating=&tag=&…&sort=&dir=&page=&size=`
 * (lib/inbox.ts parseInboxParams), with every tab's count under the same
 * search and filters. `facets=1` adds what the filter panel offers. Without
 * a sort or page size, the signed-in person's remembered ones apply.
 * `stats` are the whole project's, for the stat tiles.
 */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const sp = new URL(req.url).searchParams;
  const prefs = getInboxPrefs(getRequestSession(req)?.email);
  const q = parseInboxParams(sp, { sort: prefs.inboxSort, dir: prefs.inboxDir, pageSize: prefs.pageSize });
  const { items, total } = queryTestimonials(project.id, q);
  return Response.json({
    // The withdrawal link's hash is only ever compared on the server.
    items: items.map(({ withdrawTokenHash: _hash, ...t }) => t),
    total,
    page: q.page,
    pageSize: q.pageSize,
    counts: inboxCounts(project.id, q),
    stats: inboxStats(project.id),
    ...(sp.get("facets") === "1" ? { facets: inboxFacets(project.id) } : {}),
  });
}
