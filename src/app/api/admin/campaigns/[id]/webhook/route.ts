import { campaignToAdmin, disableWebhook, regenerateWebhook } from "@/lib/campaigns";
import { jsonError, requireAdmin } from "@/lib/http";
import { campaignAndProject } from "../guard";

type Ctx = { params: Promise<{ id: string }> };

/**
 * REQ-07: a new incoming webhook URL (the old one stops working). The URL is
 * in this answer only: Plaudit keeps just a hash of its token.
 */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const found = campaignAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Campaign not found");
  const { url } = regenerateWebhook(found.campaign);
  return Response.json({ url }, { status: 201 });
}

/** Turns the incoming webhook off. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const found = campaignAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Campaign not found");
  return Response.json({ campaign: campaignToAdmin(disableWebhook(found.campaign)!) });
}
