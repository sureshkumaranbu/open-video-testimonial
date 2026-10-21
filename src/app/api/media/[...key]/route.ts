import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { MIME_BY_EXT, resolveKey, UploadError } from "@/lib/storage";

/**
 * Streams uploaded media with HTTP Range support (needed for video seeking,
 * and by Safari to play video at all).
 */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  let file: string;
  try {
    file = resolveKey(key.join("/"));
  } catch (err) {
    if (err instanceof UploadError) return new Response("Not found", { status: 404 });
    throw err;
  }
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat?.isFile()) return new Response("Not found", { status: 404 });

  const mime = MIME_BY_EXT[path.extname(file).slice(1)] ?? "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };

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
