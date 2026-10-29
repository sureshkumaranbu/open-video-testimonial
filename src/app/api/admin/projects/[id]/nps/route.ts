import { jsonError, requireRole } from "@/lib/http";
import { npsFiltersFromQuery } from "@/lib/insights/http";
import { npsForms, npsSummary } from "@/lib/insights/nps";
import { getProjectById } from "@/lib/testimonials";

/** NPS-01: the NPS dashboard `?from=&to=&formId=`: score, promoters, passives, detractors, a trend and the comments. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const filters = npsFiltersFromQuery(req.url);
  if (filters instanceof Response) return filters;
  return Response.json({ summary: npsSummary(project.id, filters), forms: npsForms(project.id) }, { headers: { "Cache-Control": "private, no-store" } });
}
