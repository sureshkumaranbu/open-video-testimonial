import { analyticsUi, dashboardReport, parseRange } from "@/lib/analytics";
import { apiJson } from "@/lib/api-keys";
import { apiError, projectForKey, rangeParams, requireApi2 } from "@/lib/api-v1";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * GET /api/v1/projects/:slug/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
 * (API-02, read): the analytics dashboard's numbers for one project (default
 * the last 30 days, at most 731 days, never past today), with the period
 * just before to compare.
 */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "read");
  if (auth.error) return auth.error;
  if (!analyticsUi()) return apiError(404, "Analytics is switched off on this server");
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  const range = rangeParams(new URL(req.url).searchParams);
  if (range instanceof Response) return range;
  return apiJson({ data: dashboardReport([project.id], parseRange(range.from, range.to)) });
}
