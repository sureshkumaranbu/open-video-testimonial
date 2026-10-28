import { auditRequest } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { createWebhook, listWebhooks, webhookSchema } from "@/lib/webhook-admin";
import { firstIssue } from "@/lib/validation";

export function GET(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  return Response.json({ webhooks: listWebhooks() });
}

export async function POST(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const parsed = webhookSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  if (parsed.data.projectId && !getProjectById(parsed.data.projectId)) return jsonError(400, "Unknown project");
  const webhook = createWebhook(parsed.data);
  auditRequest(req, "webhook.create", { objectType: "webhook", objectId: webhook.id, projectId: webhook.projectId, summary: new URL(webhook.url).host, meta: { events: parsed.data.events } });
  return Response.json({ webhook }, { status: 201 });
}
