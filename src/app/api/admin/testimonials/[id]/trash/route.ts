import { getRequestSession } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/http";
import { trashTestimonial } from "@/lib/trash";

type Ctx = { params: Promise<{ id: string }> };

/** Moves a testimonial to the trash: off every public page, restorable until it's purged. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const testimonial = trashTestimonial((await ctx.params).id, { by: getRequestSession(req)?.email });
  if (!testimonial) return jsonError(404, "Testimonial not found");
  return Response.json({ testimonial });
}
