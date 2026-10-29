import { apiJson } from "@/lib/api-keys";
import { apiError, projectForKey, requireApiFeature } from "@/lib/api-v1";
import { npsFiltersSchema, npsSummary } from "@/lib/insights/nps";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * GET /api/v1/projects/:slug/nps?from=&to=&formId= (L23, NPS-01; flag
 * insights; read only): the NPS dashboard's numbers: the score, promoters,
 * passives and detractors, the 0–10 spread, a trend and the latest 100
 * comments (names, never emails).
 */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApiFeature(req, "read", "insights");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  const q = new URL(req.url).searchParams;
  const parsed = npsFiltersSchema.safeParse({ from: q.get("from") || undefined, to: q.get("to") || undefined, formId: q.get("formId") || undefined });
  if (!parsed.success) return apiError(400, firstIssue(parsed.error));
  return apiJson({ data: npsSummary(project.id, parsed.data) });
}
