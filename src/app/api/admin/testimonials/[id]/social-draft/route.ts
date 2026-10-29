import { aiForProject } from "@/lib/ai";
import { auditRequest } from "@/lib/audit";
import { getRequestSession } from "@/lib/auth";
import { ensureSocialDraft, resetSocialDraft, saveSocialDraft, socialDraftBody, socialDraftView } from "@/lib/commerce/social";
import { featureOn } from "@/lib/features";
import { jsonError, readJsonCapped, requireRole } from "@/lib/http";
import { getProjectById, getTestimonial } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** The approved testimonial, or the error to send (drafts exist only once it's approved). */
async function approved(ctx: Ctx) {
  if (!featureOn("commerce")) return jsonError(404, "Not found");
  const t = getTestimonial((await ctx.params).id);
  if (!t) return jsonError(404, "Testimonial not found");
  if (t.status !== "approved" || t.withdrawnAt) return jsonError(409, "A social post draft is made once the testimonial is approved");
  return t;
}

/** INT-08: the drawer's "Social post" panel: the draft (made from the template if it has none yet), its link and share links. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const t = await approved(ctx);
  if (t instanceof Response) return t;
  const draft = ensureSocialDraft(t)!;
  return Response.json({ draft: socialDraftView(t, draft), ai: aiForProject(getProjectById(t.projectId)) }, { headers: { "Cache-Control": "private, no-store" } });
}

/** Saves `{text, aiRewritten?}`. */
export async function PUT(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const t = await approved(ctx);
  if (t instanceof Response) return t;
  const input = await readJsonCapped(req, 16 * 1024);
  if (input instanceof Response) return input;
  const parsed = socialDraftBody.safeParse(input ?? {});
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const draft = saveSocialDraft(t, parsed.data, getRequestSession(req)?.email ?? null);
  auditRequest(req, "social_draft.update", { objectType: "testimonial", objectId: t.id, projectId: t.projectId, summary: `Changed ${t.authorName}’s social post draft` });
  return Response.json({ draft: socialDraftView(t, draft) });
}

/** Back to the template. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const t = await approved(ctx);
  if (t instanceof Response) return t;
  const draft = resetSocialDraft(t);
  auditRequest(req, "social_draft.reset", { objectType: "testimonial", objectId: t.id, projectId: t.projectId, summary: `Put ${t.authorName}’s social post draft back to the template` });
  return Response.json({ draft: socialDraftView(t, draft) });
}
