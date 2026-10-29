import { z } from "zod";
import { auditRequest } from "@/lib/audit";
import { getRequestSession } from "@/lib/auth";
import { jsonError, requireRole } from "@/lib/http";
import { firstIssue } from "@/lib/validation";
import { renderErrorResponse } from "@/lib/video/http";
import { renderToAdmin, requestMulticlip, useMulticlip } from "@/lib/video/renders";

type Ctx = { params: Promise<{ id: string }> };

/** VID-05: stitch the submission's video answers into one MP4 with a title card before each. Made in the background. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    const render = await requestMulticlip(id, { by: getRequestSession(req)?.email });
    auditRequest(req, "video.multiclip", { objectType: "testimonial", objectId: id, projectId: render.projectId, summary: "Made a multiclip" });
    return Response.json({ render: renderToAdmin(render) }, { status: 202 });
  } catch (err) {
    return renderErrorResponse(err);
  }
}

const body = z.object({ renderId: z.string().min(1).max(64).nullable() });

/** VID-05: `{renderId}` makes that multiclip the testimonial's video; `{renderId: null}` puts the first answer back. */
export async function PUT(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const { id } = await ctx.params;
  try {
    const testimonial = await useMulticlip(id, parsed.data.renderId, { by: getRequestSession(req)?.email });
    auditRequest(req, "video.multiclip_use", {
      objectType: "testimonial",
      objectId: id,
      projectId: testimonial.projectId,
      summary: parsed.data.renderId ? "Showed the multiclip as the video" : "Showed the first answer as the video again",
    });
    return Response.json({ testimonial });
  } catch (err) {
    return renderErrorResponse(err);
  }
}
