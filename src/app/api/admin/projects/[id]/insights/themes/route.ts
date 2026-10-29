import { auditRequest } from "@/lib/audit";
import { jsonError, readJsonCapped, requireRole } from "@/lib/http";
import { filtersFromBody, insightsErrorResponse } from "@/lib/insights/http";
import { vocThemes } from "@/lib/insights/voc";
import { getProjectById } from "@/lib/testimonials";

/** VOC-01 "Find themes with AI": a capped sample of the filtered testimonials (or survey comments) goes to the AI provider. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const body = await readJsonCapped(req);
  if (body instanceof Response) return body;
  const filters = filtersFromBody(body);
  if (filters instanceof Response) return filters;
  try {
    const report = await vocThemes(project, filters);
    auditRequest(req, "insights.ai_themes", { objectType: "project", objectId: project.id, projectId: project.id, summary: `Sent ${report.themes?.sampled ?? 0} ${filters.source === "survey" ? "survey comments" : "testimonials"} to the AI provider for themes` });
    return Response.json({ report });
  } catch (err) {
    return insightsErrorResponse(err);
  }
}
