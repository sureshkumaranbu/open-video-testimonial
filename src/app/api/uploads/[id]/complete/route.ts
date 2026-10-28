import { getRequestSession } from "@/lib/auth";
import { DirectUploadError } from "@/lib/direct-upload";
import { jsonError } from "@/lib/http";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { completeUpload, getUpload } from "@/lib/uploads";

/**
 * L9 direct uploads: called once every part is in the bucket. The server
 * puts the parts together, checks the real size and sniffs the first bytes;
 * `{offset}` (the size) when it's a video we take, else 413 or 415 and the
 * upload is gone, as when a relayed chunk is refused. Safe to retry.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!getRequestSession(req) && !rateLimit(`upload-chunk:${clientKey(req)}`, 1500, 10 * 60 * 1000)) {
    return jsonError(429, "Too many requests, please slow down");
  }
  const upload = getUpload((await ctx.params).id, req.headers.get("x-upload-token"));
  if (!upload) return jsonError(404, "Upload not found or expired");
  try {
    return Response.json({ offset: await completeUpload(upload) });
  } catch (err) {
    if (err instanceof DirectUploadError) return jsonError(err.status, err.message);
    console.error(`[uploads] couldn't complete direct upload ${upload.id}:`, err);
    return jsonError(503, "Storage didn't answer. Please try again.", { "Retry-After": "5" });
  }
}
