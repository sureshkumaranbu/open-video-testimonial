import { z } from "zod";
import { getRequestSession } from "@/lib/auth";
import { jsonError, requireRole } from "@/lib/http";
import { UnsupportedMediaError, UploadError } from "@/lib/storage";
import { firstIssue } from "@/lib/validation";
import { resetPoster, setPosterFrame, setPosterImage, VideoToolError } from "@/lib/video-tools";

type Ctx = { params: Promise<{ id: string }> };

const frameBody = z.object({ atMs: z.number().int("Pick a moment inside the video").min(0).max(86_400_000) });

const fail = (err: unknown) => {
  if (err instanceof VideoToolError) return jsonError(err.status, err.message);
  if (err instanceof UnsupportedMediaError) return jsonError(415, err.message);
  if (err instanceof UploadError) return jsonError(400, err.message);
  throw err;
};

/**
 * VID-02: JSON `{atMs}` uses that frame of the served video as the poster;
 * multipart field `file` (PNG, JPEG, WebP or GIF) uses an image instead.
 */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const by = getRequestSession(req)?.email;
  try {
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File) || file.size === 0) return jsonError(400, "Choose an image file for the poster");
      return Response.json({ testimonial: await setPosterImage(id, file, { by }) });
    }
    const parsed = frameBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return Response.json({ testimonial: await setPosterFrame(id, parsed.data.atMs, { by }) });
  } catch (err) {
    return fail(err);
  }
}

/** VID-02: back to the default frame. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  try {
    return Response.json({ testimonial: await resetPoster((await ctx.params).id, { by: getRequestSession(req)?.email }) });
  } catch (err) {
    return fail(err);
  }
}
