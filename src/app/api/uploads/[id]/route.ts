import { jsonError } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { UploadError } from "@/lib/storage";
import { appendChunk, CHUNK_MAX_BYTES, discardUpload, getUpload, OffsetMismatch } from "@/lib/uploads";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Resumable upload protocol:
 *   PUT  ?offset=N  with the next bytes  -> { offset }   (409 + { offset } if N is stale)
 *   GET                                   -> { offset }   (where to resume)
 *   DELETE                                -> abandons the upload
 * Every call needs the `X-Upload-Token` returned when the upload was created.
 */
async function session(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return getUpload(id, req.headers.get("x-upload-token"));
}

export async function GET(req: Request, ctx: Ctx) {
  const upload = await session(req, ctx);
  if (!upload) return jsonError(404, "Upload not found or expired");
  return Response.json({ offset: upload.received });
}

export async function PUT(req: Request, ctx: Ctx) {
  if (!rateLimit(`upload-chunk:${clientIp(req)}`, 1500, 10 * 60 * 1000)) {
    return jsonError(429, "Too many requests, please slow down");
  }
  const upload = await session(req, ctx);
  if (!upload) return jsonError(404, "Upload not found or expired");
  const offset = Number(new URL(req.url).searchParams.get("offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) return jsonError(400, "Missing or invalid offset");
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > CHUNK_MAX_BYTES) return jsonError(413, "Chunk too large");
  const bytes = new Uint8Array(await req.arrayBuffer());
  try {
    return Response.json({ offset: await appendChunk(upload, offset, bytes) });
  } catch (err) {
    if (err instanceof OffsetMismatch) {
      return Response.json({ error: "Offset mismatch", offset: err.expected }, { status: 409 });
    }
    if (err instanceof UploadError) return jsonError(413, err.message);
    throw err;
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const upload = await session(req, ctx);
  if (!upload) return jsonError(404, "Upload not found or expired");
  await discardUpload(upload.id);
  return Response.json({ ok: true });
}
