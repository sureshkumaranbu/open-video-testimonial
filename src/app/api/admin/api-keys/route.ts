import { z } from "zod";
import { API_KEY_SCOPES } from "@/db/schema";
import { createApiKey, listApiKeys } from "@/lib/api-keys";
import { jsonError, requireAdmin } from "@/lib/http";
import { firstIssue } from "@/lib/validation";

export function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return Response.json({ keys: listApiKeys() });
}

const schema = z.object({ name: z.string().trim().min(1).max(80), scope: z.enum(API_KEY_SCOPES) });

/** Creates a key. The full key is in this response only. */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const { key, row } = createApiKey(parsed.data.name, parsed.data.scope);
  return Response.json({ key, id: row.id, prefix: row.prefix, scope: row.scope }, { status: 201 });
}
