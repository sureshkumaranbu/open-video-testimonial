import { getRequestSession } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/http";
import { NoPublicConsentError } from "@/lib/testimonials";
import { NotInTrashError, restoreTestimonial } from "@/lib/trash";

type Ctx = { params: Promise<{ id: string }> };

/** Takes a testimonial out of the trash, back to the status it had (rejected, if its author withdrew). */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  let testimonial;
  try {
    testimonial = restoreTestimonial((await ctx.params).id, { by: getRequestSession(req)?.email });
  } catch (err) {
    if (err instanceof NotInTrashError || err instanceof NoPublicConsentError) return jsonError(409, err.message);
    throw err;
  }
  if (!testimonial) return jsonError(404, "Testimonial not found");
  return Response.json({ testimonial });
}
