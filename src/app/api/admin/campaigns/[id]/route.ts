import { auditRequest } from "@/lib/audit";
import {
  CampaignError,
  campaignPatch,
  campaignRewardPool,
  campaignToAdmin,
  customersWithEmail,
  deleteCampaign,
  funnelOf,
  recipientToAdmin,
  updateCampaign,
} from "@/lib/campaigns";
import { jsonError, requireRole } from "@/lib/http";
import { listRequests } from "@/lib/requests";
import { firstIssue } from "@/lib/validation";
import { campaignAndProject } from "./guard";

type Ctx = { params: Promise<{ id: string }> };

/** REQ-01/04: the campaign, its funnel, every recipient, and the customers it can pick from. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const found = campaignAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Campaign not found");
  const { campaign, project } = found;
  const rows = listRequests(project.id, { campaignId: campaign.id });
  return Response.json({
    campaign: campaignToAdmin(campaign, funnelOf(rows, campaign.trackOpens)),
    recipients: rows.map((r) => recipientToAdmin(project, r)),
    customers: customersWithEmail(project.id).slice(0, 2000),
    rewardPool: campaignRewardPool(project, campaign),
  });
}

/** Saves settings, or starts, pauses and resumes it (`status`). */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const found = campaignAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Campaign not found");
  const parsed = campaignPatch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    const row = updateCampaign(found.project, found.campaign, parsed.data);
    if (parsed.data.status && parsed.data.status !== found.campaign.status) {
      auditRequest(req, parsed.data.status === "active" ? "campaign.start" : "campaign.pause", { objectType: "campaign", objectId: row.id, projectId: row.projectId, summary: row.name });
    }
    return Response.json({ campaign: campaignToAdmin(row, funnelOf(listRequests(found.project.id, { campaignId: row.id }), row.trackOpens)) });
  } catch (err) {
    if (err instanceof CampaignError) return jsonError(err.status, err.message);
    throw err;
  }
}

/** Deletes the campaign and its recipients; their links stop working. Testimonials stay. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const gone = deleteCampaign((await ctx.params).id);
  if (!gone) return jsonError(404, "Campaign not found");
  auditRequest(req, "campaign.delete", { objectType: "campaign", objectId: gone.id, projectId: gone.projectId, summary: gone.name });
  return Response.json({ ok: true });
}
