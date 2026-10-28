import { jsonError, requireRole } from "@/lib/http";
import { getTestimonialDetail } from "@/lib/testimonial-detail";

type Ctx = { params: Promise<{ id: string }> };

/** Everything the detail drawer shows: the testimonial, answers, images, highlights, history, customer, feedback and form. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const detail = getTestimonialDetail((await ctx.params).id);
  if (!detail) return jsonError(404, "Testimonial not found");
  return Response.json(detail);
}
