import { jsonError, requireAdmin } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { getWebhook } from "@/lib/webhook-admin";
import { sendTestEvent } from "@/lib/webhooks";

/** Queues a "ping" event to this endpoint. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const hook = getWebhook((await ctx.params).id);
  if (!hook) return jsonError(404, "Webhook not found");
  const id = sendTestEvent(hook, hook.projectId ? getProjectById(hook.projectId) : null);
  return Response.json({ deliveryId: id }, { status: 202 });
}
