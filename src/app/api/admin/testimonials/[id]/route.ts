import { auditRequest, testimonialAction } from "@/lib/audit";
import { getRequestSession } from "@/lib/auth";
import { CaptionsError, normaliseCaptions } from "@/lib/captions";
import { jsonError, requireRole } from "@/lib/http";
import { ConsentWithdrawnError, deleteTestimonial, DuplicateReviewError, getTestimonial, NoPublicConsentError, updateTestimonial } from "@/lib/testimonials";
import { firstIssue, testimonialUpdateSchema } from "@/lib/validation";
// Registers the notifications listener in this route's bundle (approvals post to chat channels).
import "@/lib/notifications";
// And smart search's (INBOX-14): an edit is embedded again a little later.
import "@/lib/embeddings";

type Ctx = { params: Promise<{ id: string }> };

/** Approve, reject or hide; rename, retag or edit a testimonial. The history records who did it. */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const parsed = testimonialUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const patch = { ...parsed.data };
  for (const field of ["text", "transcript", "captionsVtt"] as const) {
    if (patch[field] === "") patch[field] = null;
  }
  if (patch.captionsVtt) {
    try {
      patch.captionsVtt = normaliseCaptions(patch.captionsVtt);
    } catch (err) {
      if (err instanceof CaptionsError) return jsonError(400, err.message);
      throw err;
    }
  }
  let testimonial;
  try {
    testimonial = updateTestimonial(id, patch, { by: getRequestSession(req)?.email });
  } catch (err) {
    if (err instanceof ConsentWithdrawnError || err instanceof NoPublicConsentError || err instanceof DuplicateReviewError) {
      return jsonError(409, err.message);
    }
    throw err;
  }
  if (!testimonial) return jsonError(404, "Testimonial not found");
  for (const action of testimonialAction(patch)) {
    auditRequest(req, action, { objectType: "testimonial", objectId: id, projectId: testimonial.projectId, summary: testimonial.authorName, meta: { fields: Object.keys(patch) } });
  }
  return Response.json({ testimonial });
}

/** Deletes for good (the dashboard offers this only from the trash; POST …/trash moves it there). */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const before = getTestimonial(id);
  if (!(await deleteTestimonial(id))) return jsonError(404, "Testimonial not found");
  auditRequest(req, "testimonial.delete", { objectType: "testimonial", objectId: id, projectId: before?.projectId, summary: before?.authorName });
  return Response.json({ ok: true });
}
