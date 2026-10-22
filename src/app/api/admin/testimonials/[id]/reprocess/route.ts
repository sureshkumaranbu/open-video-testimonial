import { jsonError, requireAdmin } from "@/lib/http";
import { queueVideoProcessing } from "@/lib/media";
import { getTestimonial } from "@/lib/testimonials";

/** Runs the video conversion again (after a failure, or once ffmpeg is installed). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const t = getTestimonial(id);
  if (!t) return jsonError(404, "Testimonial not found");
  if (!t.videoKey) return jsonError(400, "This testimonial has no video");
  await queueVideoProcessing(id);
  return Response.json({ testimonial: getTestimonial(id) });
}
