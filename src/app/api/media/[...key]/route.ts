import { canOpen, projectAccessFor } from "@/lib/access";
import { apiKeyReaches, requireApiKey } from "@/lib/api-keys";
import { getRequestSession } from "@/lib/auth";
import { isMediaKey, mimeForKey, storage, type StorageDriver } from "@/lib/storage";
import { isMediaPublic, mediaProjectIds } from "@/lib/testimonials";

/**
 * Who may fetch a file that isn't public: someone signed in, or a REST API
 * key (integrations get the same media URLs the REST API and webhooks hand
 * out). L18: a member or key limited to some projects only gets files that
 * belong to one of them; the projects are looked up only for them, so
 * everyone else costs no extra query.
 */
function mayReadPrivate(req: Request, key: string) {
  let projects: string[] | null = null;
  const owners = () => (projects ??= mediaProjectIds(key));
  const session = getRequestSession(req);
  if (session) {
    const access = projectAccessFor(session.email, session.role);
    if (access.all || owners().some((id) => canOpen(access, id))) return true;
  }
  if (!req.headers.has("authorization")) return false;
  const auth = requireApiKey(req, "read");
  if (!("key" in auth) || !auth.key) return false;
  const apiKey = auth.key;
  return apiKey.allProjects || owners().some((id) => apiKeyReaches(apiKey, id));
}

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
const unavailable = () => new Response("Media storage is unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });

/**
 * Streams uploaded media with HTTP Range support (needed for video seeking,
 * and by Safari to play video at all), from local disk or the S3 bucket.
 * Bucket objects are relayed, never redirected to, so the privacy check below
 * runs on every request and `media-src 'self'` keeps working (D16).
 *
 * Anyone may fetch a file only while its testimonial is approved and not
 * withdrawn; everything else (pending, rejected, withdrawn, or not attached
 * to a testimonial) is for the signed-in team or a REST API key only, and a
 * 404 to everyone else; a member or key limited to some projects gets only
 * those projects' files (L18). Public files are cacheable but must be revalidated on every use, so
 * a rejection or withdrawal takes effect immediately rather than when some
 * cache expires.
 */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await ctx.params;
  const key = parts.join("/");
  if (!isMediaKey(key)) return notFound();
  const isPublic = isMediaPublic(key);
  if (!isPublic && !mayReadPrivate(req, key)) return notFound();
  let stat: Awaited<ReturnType<StorageDriver["stat"]>>;
  try {
    stat = await storage().stat(key);
  } catch (err) {
    console.error(`[media] couldn't look up ${key}:`, err);
    return unavailable();
  }
  if (!stat) return notFound();

  const mime = mimeForKey(key);
  const etag = stat.etag;
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
  let start = 0;
  let end = stat.size - 1;
  if (match) {
    if (match[1] === "") {
      // Suffix range: the last N bytes.
      start = Math.max(stat.size - Number(match[2]), 0);
    } else {
      start = Number(match[1]);
      end = match[2] === "" ? stat.size - 1 : Math.min(Number(match[2]), stat.size - 1);
    }
    if (start > end || start >= stat.size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    }
  }

  let body: ReadableStream<Uint8Array> | null;
  try {
    body = await storage().read(key, match ? { start, end } : undefined);
  } catch (err) {
    console.error(`[media] couldn't read ${key}:`, err);
    return unavailable();
  }
  if (!body) return notFound();
  if (match) {
    return new Response(body, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }
  return new Response(body, { headers: { ...headers, "Content-Length": String(stat.size) } });
}
