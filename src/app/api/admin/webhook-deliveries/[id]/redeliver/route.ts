import { jsonError, requireRole } from "@/lib/http";
import { redeliver } from "@/lib/webhooks";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  if (!redeliver((await ctx.params).id)) return jsonError(404, "Delivery not found");
  return Response.json({ ok: true }, { status: 202 });
}
