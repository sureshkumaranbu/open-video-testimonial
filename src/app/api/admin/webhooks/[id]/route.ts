import { jsonError, requireAdmin } from "@/lib/http";
import { deleteWebhook, updateWebhook, webhookSchema } from "@/lib/webhook-admin";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const parsed = webhookSchema.partial().safeParse(body);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const hook = updateWebhook((await ctx.params).id, { ...parsed.data, rotateSecret: body?.rotateSecret === true });
  if (!hook) return jsonError(404, "Webhook not found");
  return Response.json({ webhook: hook });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!deleteWebhook((await ctx.params).id)) return jsonError(404, "Webhook not found");
  return Response.json({ ok: true });
}
