import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { requireApiKey } from "@/lib/api-keys";
import { getRequestSession } from "@/lib/auth";
import { MIME_BY_EXT, resolveKey, UploadError } from "@/lib/storage";
import { isMediaPublic } from "@/lib/testimonials";

/** API integrations get the same media URLs the REST API and webhooks hand out. */
function hasApiKey(req: Request) {
  return req.headers.has("authorization") && "key" in requireApiKey(req, "read");
}

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * Streams uploaded media with HTTP Range support (needed for video seeking,
 * and by Safari to play video at all).
 *
 * Anyone may fetch a file only while its testimonial is approved and not
 * withdrawn; everything else (pending, rejected, withdrawn, or not attached
 * to a testimonial) is for the signed-in owner or a REST API key only, and a
 * 404 to everyone else. Public files are cacheable but must be revalidated on every use, so
 * a rejection or withdrawal takes effect immediately rather than when some
 * cache expires.
 */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await ctx.params;
  const key = parts.join("/");
  let file: string;
  try {
    file = resolveKey(key);
  } catch (err) {
    if (err instanceof UploadError) return notFound();
    throw err;
  }
  const isPublic = isMediaPublic(key);
  if (!isPublic && !getRequestSession(req) && !hasApiKey(req)) return notFound();
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat?.isFile()) return notFound();

  const mime = MIME_BY_EXT[path.extname(file).slice(1)] ?? "application/octet-stream";
  const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
  const headers: Record<string, string> = isPublic
    ? {
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, no-cache",
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      }
    : {
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      };

  if (isPublic && !req.headers.get("range") && req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  const range = req.headers.get("range");
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (range && !match) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
  }
  if (match) {
    let start: number;
    let end: number;
    if (match[1] === "") {
      // Suffix range: the last N bytes.
      start = Math.max(stat.size - Number(match[2]), 0);
      end = stat.size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] === "" ? stat.size - 1 : Math.min(Number(match[2]), stat.size - 1);
    }
    if (start > end || start >= stat.size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    }
    const stream = fs.createReadStream(file, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  const stream = fs.createReadStream(file);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: { ...headers, "Content-Length": String(stat.size) },
  });
}
