import { apiJson } from "@/lib/api-keys";
import { audit, keyActor } from "@/lib/audit";
import { apiError, campaignToApi, libError, MAX_SMALL_BYTES, projectOfRow, readJson, requireApi2 } from "@/lib/api-v1";
import { campaignPatch, deleteCampaign, funnelOf, getCampaign, updateCampaign } from "@/lib/campaigns";
import { listRequests } from "@/lib/requests";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/campaigns/:id (API-01): the campaign and its funnel (recipients are at …/recipients). */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "read");
  if (auth.error) return auth.error;
  const campaign = getCampaign((await ctx.params).id);
  const project = projectOfRow(auth.key, campaign);
  if (!campaign || !project) return apiError(404, "Campaign not found");
  return apiJson({ data: campaignToApi(campaign, funnelOf(listRequests(project.id, { campaignId: campaign.id }), campaign.trackOpens)) });
}

/**
 * PATCH /api/v1/campaigns/:id (write scope): its settings and wording, or
 * `status`: "active" starts it (queuing an invitation for everyone not yet
 * sent one; 409 without email set up) and "paused" stops sends and reminders.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "write");
  if (auth.error) return auth.error;
  const campaign = getCampaign((await ctx.params).id);
  const project = projectOfRow(auth.key, campaign);
  if (!campaign || !project) return apiError(404, "Campaign not found");
  const body = await readJson(req, MAX_SMALL_BYTES);
  if (body.error) return body.error;
  const parsed = campaignPatch.safeParse(body.value);
  if (!parsed.success) return apiError(400, firstIssue(parsed.error));
  try {
    const row = updateCampaign(project, campaign, parsed.data);
    if (parsed.data.status && parsed.data.status !== campaign.status) {
      audit(keyActor(auth.key), parsed.data.status === "active" ? "campaign.start" : "campaign.pause", { objectType: "campaign", objectId: row.id, projectId: project.id, summary: row.name });
    }
    return apiJson({ data: campaignToApi(row, funnelOf(listRequests(project.id, { campaignId: row.id }), row.trackOpens)) });
  } catch (err) {
    return libError(err);
  }
}

/** DELETE /api/v1/campaigns/:id (write scope): its recipients go too, and their links stop working. Testimonials stay. */
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "write");
  if (auth.error) return auth.error;
  const campaign = getCampaign((await ctx.params).id);
  if (!campaign || !projectOfRow(auth.key, campaign) || !deleteCampaign(campaign.id)) return apiError(404, "Campaign not found");
  audit(keyActor(auth.key), "campaign.delete", { objectType: "campaign", objectId: campaign.id, projectId: campaign.projectId, summary: campaign.name });
  return apiJson({ ok: true });
}
