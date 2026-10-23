import { env } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { tooLarge } from "@/lib/sniff";
import { getProjectBySlug } from "@/lib/testimonials";
import { CHUNK_MAX_BYTES, createUpload, MAX_OPEN_UPLOADS_PER_PROJECT, openUploadCount } from "@/lib/uploads";

/** Starts a resumable video upload for the collection page. */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const project = getProjectBySlug(slug);
  if (!project) return jsonError(404, "Project not found");
  if (!project.allowVideo) return jsonError(400, "This page doesn't accept videos");
  if (!rateLimit(`upload-start:${clientKey(req)}`, 30, 10 * 60 * 1000)) {
    return jsonError(429, "Too many uploads, please try again later");
  }
  // Bounds the disk an anonymous visitor can tie up with unfinished uploads.
  if (openUploadCount(project.id) >= MAX_OPEN_UPLOADS_PER_PROJECT) {
    return jsonError(429, "Too many uploads in progress right now. Please try again in a while.");
  }
  // A picked file's size is known up front: refuse it before a byte is sent.
  const body = (await req.json().catch(() => ({}))) as { size?: unknown };
  if (typeof body.size === "number" && body.size > env.maxVideoBytes) {
    return jsonError(413, tooLarge(env.maxVideoBytes));
  }
  const { upload, token } = createUpload("video", { projectId: project.id, maxBytes: env.maxVideoBytes });
  return Response.json(
    { id: upload.id, token, offset: 0, chunkSize: CHUNK_MAX_BYTES, expiresAt: upload.expiresAt.toISOString() },
    { status: 201 },
  );
}
