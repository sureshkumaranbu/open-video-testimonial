import { getRequestSession } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { clientKey, rateLimit } from "@/lib/rate-limit";
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

async function readCapped(req: Request, max: number) {
  const parts: Uint8Array[] = [];
  let size = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      parts.push(value);
    }
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

export async function GET(req: Request, ctx: Ctx) {
  const upload = await session(req, ctx);
  if (!upload) return jsonError(404, "Upload not found or expired");
  return Response.json({ offset: upload.received });
}

export async function PUT(req: Request, ctx: Ctx) {
  // The owner's own archive uploads can be thousands of chunks; don't throttle them.
  if (!getRequestSession(req) && !rateLimit(`upload-chunk:${clientKey(req)}`, 1500, 10 * 60 * 1000)) {
    return jsonError(429, "Too many requests, please slow down");
  }
  const upload = await session(req, ctx);
  if (!upload) return jsonError(404, "Upload not found or expired");
  const offset = Number(new URL(req.url).searchParams.get("offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) return jsonError(400, "Missing or invalid offset");
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > CHUNK_MAX_BYTES) return jsonError(413, "Chunk too large");
  // Count while reading: a chunked request has no Content-Length to check.
  const bytes = await readCapped(req, CHUNK_MAX_BYTES);
  if (!bytes) return jsonError(413, "Chunk too large");
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
