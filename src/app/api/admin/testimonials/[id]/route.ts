import { getRequestSession } from "@/lib/auth";
import { CaptionsError, normaliseCaptions } from "@/lib/captions";
import { jsonError, requireAdmin } from "@/lib/http";
import { ConsentWithdrawnError, deleteTestimonial, NoPublicConsentError, updateTestimonial } from "@/lib/testimonials";
import { firstIssue, testimonialUpdateSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** Approve, reject or hide; rename, retag or edit a testimonial. The history records who did it. */
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
  let testimonial;
  try {
    testimonial = updateTestimonial(id, patch, { by: getRequestSession(req)?.email });
  } catch (err) {
    if (err instanceof ConsentWithdrawnError || err instanceof NoPublicConsentError) return jsonError(409, err.message);
    throw err;
  }
  if (!testimonial) return jsonError(404, "Testimonial not found");
  return Response.json({ testimonial });
}

/** Deletes for good (the dashboard offers this only from the trash; POST …/trash moves it there). */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!(await deleteTestimonial(id))) return jsonError(404, "Testimonial not found");
  return Response.json({ ok: true });
}
