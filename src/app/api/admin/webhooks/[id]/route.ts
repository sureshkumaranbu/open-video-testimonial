import { jsonError, requireAdmin } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { deleteWebhook, updateWebhook, webhookPatchSchema } from "@/lib/webhook-admin";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const parsed = webhookPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  if (parsed.data.projectId && !getProjectById(parsed.data.projectId)) return jsonError(400, "Unknown project");
  const hook = updateWebhook((await ctx.params).id, parsed.data);
  if (!hook) return jsonError(404, "Webhook not found");
  return Response.json({ webhook: hook });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!deleteWebhook((await ctx.params).id)) return jsonError(404, "Webhook not found");
  return Response.json({ ok: true });
}
