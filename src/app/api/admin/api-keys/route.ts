import { auditRequest } from "@/lib/audit";
import { z } from "zod";
import { API_KEY_SCOPES } from "@/db/schema";
import { createApiKey, listApiKeys } from "@/lib/api-keys";
import { jsonError, requireRole } from "@/lib/http";
import { firstIssue } from "@/lib/validation";

export function GET(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  return Response.json({ keys: listApiKeys() });
}

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(API_KEY_SCOPES),
  /** TEAM-01: only these projects; absent or null for every project. */
  projectIds: z.array(z.string().max(64)).max(200).nullish(),
});

/** Creates a key. The full key is in this response only. */
export async function POST(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const { key, row } = createApiKey(parsed.data.name, parsed.data.scope, parsed.data.projectIds ?? null);
  auditRequest(req, "api_key.create", { objectType: "api_key", objectId: row.id, summary: `${row.name} (${row.prefix}…)`, meta: { scope: row.scope, projectIds: parsed.data.projectIds ?? "all" } });
  return Response.json({ key, id: row.id, prefix: row.prefix, scope: row.scope }, { status: 201 });
}
