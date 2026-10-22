import { jsonError, requireAdmin } from "@/lib/http";
import { getWebhook } from "@/lib/webhook-admin";
import { listDeliveries } from "@/lib/webhooks";

/** The latest deliveries to this endpoint, newest first. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!getWebhook(id)) return jsonError(404, "Webhook not found");
  return Response.json({ deliveries: listDeliveries(id) });
}
