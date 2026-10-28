import { canOpen, type Level, projectAccessFor, projectOfPath, roleAtLeast } from "./access";
import { getRequestSession, isSameSiteRequest } from "./auth";

export function jsonError(status: number, error: string, headers?: HeadersInit) {
  return Response.json({ error }, { status, headers });
}

/**
 * Guards a dashboard API route (TEAM-01): signed in, a same-site request for
 * anything but a read, a role of at least `level` (viewer < editor < admin <
 * owner), and access to the project the path is about, if it's about one.
 * Returns an error Response, or null if allowed. Every route under
 * /api/admin calls this or requireOwner (tests/guard-rails.test.ts checks).
 */
export function requireRole(req: Request, level: Level) {
  const session = getRequestSession(req);
  if (!session) return jsonError(401, "Not signed in");
  if (req.method !== "GET" && req.method !== "HEAD" && !isSameSiteRequest(req)) return jsonError(403, "Cross-origin request blocked");
  if (!roleAtLeast(session.role, level)) {
    return jsonError(403, level === "editor" ? "Your role can only view and share. Ask an admin to change this." : "Only an admin can do this");
  }
  const projectId = projectOfPath(new URL(req.url).pathname);
  if (projectId && !canOpen(projectAccessFor(session.email, session.role), projectId)) return jsonError(403, "You don't have access to this project");
  return null;
}

/** For a project named in the body or query rather than the path: null when the signed-in person may open it. */
export function requireProjectAccess(req: Request, projectId: string) {
  const session = getRequestSession(req);
  if (!session) return jsonError(401, "Not signed in");
  return canOpen(projectAccessFor(session.email, session.role), projectId) ? null : jsonError(403, "You don't have access to this project");
}

/** The projects the signed-in person may open (call after requireRole). */
export function requestAccess(req: Request) {
  const session = getRequestSession(req)!;
  return projectAccessFor(session.email, session.role);
}

/** For what only the owner may do (managing the team, storage). */
export function requireOwner(req: Request) {
  const denied = requireRole(req, "admin");
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
