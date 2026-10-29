import { auditRequest } from "@/lib/audit";
import { ensureSocialDraft } from "@/lib/commerce/social";
import { rewriteSocialDraft, SocialAiError } from "@/lib/commerce/social-ai";
import { featureOn } from "@/lib/features";
import { jsonError, requireRole } from "@/lib/http";
import { getProjectById, getTestimonial } from "@/lib/testimonials";

/**
 * INT-08 "Rewrite with AI": the testimonial's own words and the current draft
 * go to the owner's AI provider; a suggestion comes back for the editor
 * (nothing is saved). 409 while AI is off for the project.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  if (!featureOn("commerce")) return jsonError(404, "Not found");
  const t = getTestimonial((await ctx.params).id);
  const project = t && getProjectById(t.projectId);
  if (!t || !project) return jsonError(404, "Testimonial not found");
  const draft = ensureSocialDraft(t);
  if (!draft || t.withdrawnAt) return jsonError(409, "A social post draft is made once the testimonial is approved");
  try {
    const suggestion = await rewriteSocialDraft(project, t, draft.text);
    auditRequest(req, "social_draft.ai_rewrite", { objectType: "testimonial", objectId: t.id, projectId: t.projectId, summary: "Sent a testimonial to the AI provider to rewrite its social post" });
    return Response.json({ suggestion });
  } catch (err) {
    if (err instanceof SocialAiError) {
      if (err.status !== 409) auditRequest(req, "social_draft.ai_rewrite", { objectType: "testimonial", objectId: t.id, projectId: t.projectId, summary: `Sent a testimonial to the AI provider; its rewrite was refused: ${err.message}`.slice(0, 300) });
      return jsonError(err.status, err.message);
    }
    throw err;
  }
}
