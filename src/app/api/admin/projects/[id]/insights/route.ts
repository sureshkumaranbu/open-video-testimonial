import { aiForProject } from "@/lib/ai";
import { jsonError, requireRole } from "@/lib/http";
import { filtersFromQuery, mayUseAi } from "@/lib/insights/http";
import { vocReport } from "@/lib/insights/voc";
import { getProjectById } from "@/lib/testimonials";

/**
 * VOC-01: Voice of Customer without AI, `?from=&to=&tags=&source=testimonials|survey&formId=`:
 * the rating and sentiment breakdown and the words and phrases most of them share, counted from the search index.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const filters = filtersFromQuery(req.url);
  if (filters instanceof Response) return filters;
  return Response.json({ report: vocReport(project.id, filters), ai: aiForProject(project), canUseAi: mayUseAi(req) }, { headers: { "Cache-Control": "private, no-store" } });
}
