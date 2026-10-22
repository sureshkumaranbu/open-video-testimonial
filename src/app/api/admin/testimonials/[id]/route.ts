import { CaptionsError, normaliseCaptions } from "@/lib/captions";
import { jsonError, requireAdmin } from "@/lib/http";
import { deleteTestimonial, updateTestimonial } from "@/lib/testimonials";
import { firstIssue, testimonialUpdateSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** Approve/reject, rename, or retag a testimonial. */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
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
  const testimonial = updateTestimonial(id, patch);
  if (!testimonial) return jsonError(404, "Testimonial not found");
  return Response.json({ testimonial });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!(await deleteTestimonial(id))) return jsonError(404, "Testimonial not found");
  return Response.json({ ok: true });
}
