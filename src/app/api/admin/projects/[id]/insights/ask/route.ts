import { auditRequest } from "@/lib/audit";
import { jsonError, readJsonCapped, requireRole } from "@/lib/http";
import { filtersFromBody, insightsErrorResponse, mayUseAi } from "@/lib/insights/http";
import { askQuestion } from "@/lib/insights/voc";
import { getProjectById } from "@/lib/testimonials";

/**
 * VOC-01 ask a question `{question, from?, to?, tags?}`: the testimonials that
 * answer it (smart search when it's on, else keywords), and for an editor
 * with AI on, a short answer citing them.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const body = await readJsonCapped(req);
  if (body instanceof Response) return body;
  const filters = filtersFromBody(body);
  if (filters instanceof Response) return filters;
  const question = typeof (body as { question?: unknown })?.question === "string" ? (body as { question: string }).question : "";
  try {
    const result = await askQuestion(project, question, filters, { summarize: mayUseAi(req) });
    if (result.answer !== null) auditRequest(req, "insights.ai_ask", { objectType: "project", objectId: project.id, projectId: project.id, summary: `Asked the AI provider about ${result.matches.length} testimonials` });
    return Response.json({ result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return insightsErrorResponse(err);
  }
}
