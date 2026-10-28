import { z } from "zod";
import { getRequestSession } from "@/lib/auth";
import { DirectUploadError, presignPart } from "@/lib/direct-upload";
import { jsonError, readJsonCapped } from "@/lib/http";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { discardUpload, getUpload } from "@/lib/uploads";
import { firstIssue } from "@/lib/validation";

const schema = z.object({ partNumber: z.number().int(), size: z.number().int() });

/**
 * L9 direct uploads: `{partNumber, size}` -> `{url, headers, expiresIn}`, a
 * presigned PUT for that part of this session's object, which must be sent
 * with exactly those headers and `size` bytes. Needs the `X-Upload-Token`,
 * like every call on an upload. Then POST …/complete.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // Rate-limited like chunks: one presign per 8 MB part.
  if (!getRequestSession(req) && !rateLimit(`upload-chunk:${clientKey(req)}`, 1500, 10 * 60 * 1000)) {
    return jsonError(429, "Too many requests, please slow down");
  }
  const upload = getUpload((await ctx.params).id, req.headers.get("x-upload-token"));
  if (!upload) return jsonError(404, "Upload not found or expired");
  const raw = await readJsonCapped(req, 1024);
  if (raw instanceof Response) return raw;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    return Response.json(presignPart(upload, parsed.data.partNumber, parsed.data.size), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (!(err instanceof DirectUploadError)) throw err;
    // Too large is about the file, so the session goes, as on the relayed path.
    if (err.status === 413) await discardUpload(upload.id);
    return jsonError(err.status, err.message);
  }
}
