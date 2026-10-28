import { jsonError, requireRole } from "@/lib/http";
import { checklistBody, checklistState, OnboardingError, updateChecklist } from "@/lib/onboarding";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** The Get started checklist (ONB-05), live. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const id = (await ctx.params).id;
  if (!getProjectById(id)) return jsonError(404, "Project not found");
  return Response.json({ checklist: checklistState(id) });
}

/** `{step, action: "done"|"skip"|"undo"}` ticks or skips a step; `{dismiss: true}` hides a finished list. */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const parsed = checklistBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    return Response.json({ checklist: updateChecklist((await ctx.params).id, parsed.data) });
  } catch (err) {
    if (err instanceof OnboardingError) return jsonError(err.status, err.message);
    throw err;
  }
}
