/** Browser-based MCP clients call these endpoints cross-origin; they carry no cookies, so any origin may. */
export function preflight() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400" },
  });
}

/** The body as fields: form-encoded (the standard) or JSON, at most 16 KB. */
export async function readFields(req: Request): Promise<URLSearchParams | null> {
  const text = await req.text().catch(() => null);
  if (text === null || text.length > 16 * 1024) return null;
  if (/^application\/json/i.test(req.headers.get("content-type") ?? "")) {
    try {
      const o = JSON.parse(text) as Record<string, unknown>;
      return new URLSearchParams(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
    } catch {
      return null;
    }
  }
  return new URLSearchParams(text);
}
