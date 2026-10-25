import { toApi } from "@/lib/api-shape";
import { apiJson, requireApiKey } from "@/lib/api-keys";
import { CaptionsError, normaliseCaptions } from "@/lib/captions";
import { jsonError } from "@/lib/http";
import { ConsentWithdrawnError, deleteTestimonial, getTestimonial, NoPublicConsentError, updateTestimonial } from "@/lib/testimonials";
import { firstIssue, testimonialUpdateSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/testimonials/:id */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApiKey(req, "read");
  if (auth.error) return auth.error;
  const t = getTestimonial((await ctx.params).id);
  if (!t) return jsonError(404, "Testimonial not found");
  return apiJson({ data: toApi(t) });
}

/** PATCH /api/v1/testimonials/:id (write scope): moderate (including hidden), retag or edit. */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = requireApiKey(req, "write");
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
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
    return apiJson({ data: toApi(t) });
  } catch (err) {
    if (err instanceof ConsentWithdrawnError || err instanceof NoPublicConsentError) return jsonError(409, err.message);
    throw err;
  }
}

/** DELETE /api/v1/testimonials/:id (write scope): deletes for good, with its media. */
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = requireApiKey(req, "write");
  if (auth.error) return auth.error;
  if (!(await deleteTestimonial((await ctx.params).id))) return jsonError(404, "Testimonial not found");
  return apiJson({ ok: true });
}
