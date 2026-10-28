import { toApi } from "@/lib/api-shape";
import { apiJson, requireApiKey } from "@/lib/api-keys";
import { keyCanAccess } from "@/lib/api-v1";
import { audit, keyActor } from "@/lib/audit";
import { CaptionsError, normaliseCaptions } from "@/lib/captions";
import { jsonError } from "@/lib/http";
import { ConsentWithdrawnError, deleteTestimonial, DuplicateReviewError, getTestimonial, NoPublicConsentError, updateTestimonial } from "@/lib/testimonials";
import { firstIssue, testimonialUpdateSchema } from "@/lib/validation";
// Registers the notifications listener in this route's bundle (approvals post to chat channels).
import "@/lib/notifications";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/testimonials/:id */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApiKey(req, "read");
  if (auth.error) return auth.error;
  const t = getTestimonial((await ctx.params).id);
  if (!t || !keyCanAccess(auth.key, t.projectId)) return jsonError(404, "Testimonial not found");
  return apiJson({ data: toApi(t) });
}

/** PATCH /api/v1/testimonials/:id (write scope): moderate (including hidden), retag or edit. */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = requireApiKey(req, "write");
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  const before = getTestimonial(id);
  if (!before || !keyCanAccess(auth.key, before.projectId)) return jsonError(404, "Testimonial not found");
  const parsed = testimonialUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const patch = { ...parsed.data };
  if (patch.captionsVtt) {
    try {
      patch.captionsVtt = normaliseCaptions(patch.captionsVtt);
    } catch (err) {
      if (err instanceof CaptionsError) return jsonError(400, err.message);
      throw err;
    }
  }
  try {
    const t = updateTestimonial(id, patch, { actor: "api" });
    if (!t) return jsonError(404, "Testimonial not found");
    auditChange(auth.key, before, patch);
    return apiJson({ data: toApi(t) });
  } catch (err) {
    if (err instanceof ConsentWithdrawnError || err instanceof NoPublicConsentError || err instanceof DuplicateReviewError) {
      return jsonError(409, err.message);
    }
    throw err;
  }
}

/** DELETE /api/v1/testimonials/:id (write scope): deletes for good, with its media. */
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = requireApiKey(req, "write");
  if (auth.error) return auth.error;
  const t = getTestimonial((await ctx.params).id);
  if (!t || !keyCanAccess(auth.key, t.projectId)) return jsonError(404, "Testimonial not found");
  if (!(await deleteTestimonial(t.id))) return jsonError(404, "Testimonial not found");
  audit(keyActor(auth.key), "testimonial.delete", { objectType: "testimonial", objectId: t.id, projectId: t.projectId, summary: t.authorName });
  return apiJson({ ok: true });
}

/** TEAM-02: a status change is logged as what it does (approve, hide…); anything else as an edit. */
function auditChange(key: Parameters<typeof keyActor>[0], t: NonNullable<ReturnType<typeof getTestimonial>>, patch: { status?: string }) {
  const fields = Object.keys(patch);
  const o = { objectType: "testimonial", objectId: t.id, projectId: t.projectId, summary: t.authorName, meta: { fields, ...(patch.status ? { status: patch.status } : {}) } };
  if (fields.includes("status")) audit(keyActor(key), "testimonial.status", o);
  if (fields.some((f) => f !== "status" && f !== "tags")) audit(keyActor(key), "testimonial.edit", o);
  if (fields.includes("tags")) audit(keyActor(key), "testimonial.tag", o);
}
