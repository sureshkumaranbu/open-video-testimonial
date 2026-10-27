import { getRequestSession, isSameSiteRequest } from "./auth";

export function jsonError(status: number, error: string, headers?: HeadersInit) {
  return Response.json({ error }, { status, headers });
}

/** Guards an admin API route: returns an error Response, or null if allowed. */
export function requireAdmin(req: Request) {
  if (!getRequestSession(req)) return jsonError(401, "Not signed in");
  if (req.method !== "GET" && req.method !== "HEAD" && !isSameSiteRequest(req)) return jsonError(403, "Cross-origin request blocked");
  return null;
}

/** Like requireAdmin, for what only the owner may do (managing the team). */
export function requireOwner(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return getRequestSession(req)!.role === "owner" ? null : jsonError(403, "Only the owner can do this");
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** The most a JSON body to an admin route may be unless the route says otherwise. */
export const MAX_JSON_BYTES = 64 * 1024;

/** The body as bytes, or null once it passes `max` bytes (it stops reading there, even without a Content-Length). */
export async function readCappedBytes(req: Request, max: number): Promise<Buffer | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** The body as text, or null once it passes `max` bytes. */
export async function readCappedText(req: Request, max: number): Promise<string | null> {
  const bytes = await readCappedBytes(req, max);
  return bytes === null ? null : bytes.toString("utf8");
}

/**
 * Reads a JSON body of at most `max` bytes: the parsed value, null when it
 * isn't JSON, or a 413 Response to return as it is.
 */
export async function readJsonCapped(req: Request, max = MAX_JSON_BYTES): Promise<unknown> {
  const raw = await readCappedText(req, max);
  if (raw === null) return jsonError(413, `That's more than ${Math.round(max / 1024)} KB. Send less at a time.`);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
