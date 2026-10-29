import { auditRequest } from "@/lib/audit";
import { FormError } from "@/lib/forms";
import { draftSurvey } from "@/lib/forms/survey";
import { jsonError, readJsonCapped, requireRole } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";

/**
 * NPS-01 "AI survey" `{goal}`: the goal goes to the AI provider and a draft
 * (name, NPS wording, up to five questions) comes back for the owner to edit
 * before making the survey. Nothing is saved here.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const body = await readJsonCapped(req);
  if (body instanceof Response) return body;
  const goal = typeof (body as { goal?: unknown } | null)?.goal === "string" ? (body as { goal: string }).goal : "";
  try {
    const draft = await draftSurvey(project, goal);
    auditRequest(req, "form.survey_ai_draft", { objectType: "project", objectId: project.id, projectId: project.id, summary: "Sent a survey goal to the AI provider for draft questions" });
    return Response.json({ draft });
  } catch (err) {
    if (err instanceof FormError) return jsonError(err.status, err.message);
    throw err;
  }
}
