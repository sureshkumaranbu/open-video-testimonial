import { jsonError, requireRole } from "@/lib/http";
import { getTestimonial } from "@/lib/testimonials";
import { listTestimonialRenders, multiclipInUse, multiclipSources, renderToAdmin } from "@/lib/video/renders";

/**
 * M16 in the drawer: the testimonial's multiclips and social clips (VID-05,
 * VID-07), whether a multiclip can be made and which one is its video, and
 * whether it has captions to burn in.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const t = getTestimonial((await ctx.params).id);
  if (!t) return jsonError(404, "Testimonial not found");
  const used = multiclipInUse(t);
  return Response.json(
    {
      renders: listTestimonialRenders(t.id).map(renderToAdmin),
      multiclip: { clips: t.videoKey ? multiclipSources(t).length : 0, inUse: used?.id ?? null },
      captions: Boolean(t.captionsVtt || t.transcript),
      durationMs: t.videoDurationMs,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
