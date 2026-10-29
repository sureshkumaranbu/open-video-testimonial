import { auditRequest } from "@/lib/audit";
import { CaseStudyError, draftCaseStudy, getCaseStudy } from "@/lib/case-studies";
import { jsonError, requireRole } from "@/lib/http";

/**
 * SHARE-04 "Draft with AI": the testimonial's own words go to the owner's AI
 * provider and the suggested fields come back for the editor (nothing is
 * saved). 409 when AI is off for the project.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const cs = getCaseStudy((await ctx.params).id);
  if (!cs) return jsonError(404, "Case study not found");
  try {
    const draft = await draftCaseStudy(cs);
    auditRequest(req, "case_study.ai_draft", { objectType: "case_study", objectId: cs.id, projectId: cs.projectId, summary: "Sent a testimonial to the AI provider to draft a case study" });
    return Response.json({ draft });
  } catch (err) {
    if (err instanceof CaseStudyError) return jsonError(err.status, err.message);
    throw err;
  }
}
