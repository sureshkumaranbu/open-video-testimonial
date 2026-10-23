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

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
