import { z } from "zod";
import { getRequestSession } from "@/lib/auth";
import { jsonError, requireRole } from "@/lib/http";
import { UnsupportedMediaError, UploadError } from "@/lib/storage";
import { firstIssue } from "@/lib/validation";
import { replaceVideo, VideoToolError } from "@/lib/video-tools";

const body = z.object({ upload: z.object({ id: z.string().max(64), token: z.string().min(1).max(200) }) });

/**
 * VID-03: replaces the video with a finished resumable upload (start one with
 * POST /api/admin/uploads `{kind: "video", projectId}`). The pipeline and the
 * transcript run again; the old files are removed.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    const testimonial = await replaceVideo((await ctx.params).id, parsed.data.upload, { by: getRequestSession(req)?.email });
    return Response.json({ testimonial });
  } catch (err) {
    if (err instanceof VideoToolError) return jsonError(err.status, err.message);
    if (err instanceof UnsupportedMediaError) return jsonError(415, err.message);
    if (err instanceof UploadError) return jsonError(400, err.message);
    throw err;
  }
}
