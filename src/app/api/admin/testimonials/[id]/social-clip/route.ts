import { auditRequest } from "@/lib/audit";
import { getRequestSession } from "@/lib/auth";
import { requireRole } from "@/lib/http";
import { renderErrorResponse } from "@/lib/video/http";
import { renderToAdmin, requestSocialClip } from "@/lib/video/renders";

/**
 * VID-07: a vertical or square clip with word-by-word captions, the brand
 * colour, the logo and a name tag, in one of our looks. Body: socialOptionsSchema
 * (src/lib/video/reel-config.ts). Made in the background; download it when ready.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    const render = await requestSocialClip(id, await req.json().catch(() => ({})), { by: getRequestSession(req)?.email });
    auditRequest(req, "video.social_clip", { objectType: "testimonial", objectId: id, projectId: render.projectId, summary: "Made a social clip" });
    return Response.json({ render: renderToAdmin(render) }, { status: 202 });
  } catch (err) {
    return renderErrorResponse(err);
  }
}
