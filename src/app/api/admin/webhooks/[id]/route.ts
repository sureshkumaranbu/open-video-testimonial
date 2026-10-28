import { auditRequest } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { deleteWebhook, updateWebhook, webhookPatchSchema } from "@/lib/webhook-admin";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const parsed = webhookPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  if (parsed.data.projectId && !getProjectById(parsed.data.projectId)) return jsonError(400, "Unknown project");
  const hook = updateWebhook((await ctx.params).id, parsed.data);
  if (!hook) return jsonError(404, "Webhook not found");
  auditRequest(req, "webhook.update", { objectType: "webhook", objectId: hook.id, projectId: hook.projectId, summary: new URL(hook.url).host, meta: { fields: Object.keys(parsed.data) } });
  return Response.json({ webhook: hook });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!deleteWebhook(id)) return jsonError(404, "Webhook not found");
  auditRequest(req, "webhook.delete", { objectType: "webhook", objectId: id });
  return Response.json({ ok: true });
}
