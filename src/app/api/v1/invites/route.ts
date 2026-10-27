import { z } from "zod";
import { apiJson, requireApiKey } from "@/lib/api-keys";
import { CampaignError, createInvite, getCampaign, inviteInput } from "@/lib/campaigns";
import { jsonError } from "@/lib/http";
import { inviteToApi } from "@/lib/requests";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

const body = inviteInput.extend({ campaignId: z.string().min(1, "campaignId is required").max(64) });

/**
 * POST /api/v1/invites (REQ-07, write scope): adds one person to an active
 * campaign and queues their invitation, optionally `delayDays` later. Someone
 * already in the campaign, unsubscribed or who already responded gets no
 * second email: the answer is 200 with `skipped` saying why.
 */
export async function POST(req: Request) {
  const auth = requireApiKey(req, "write");
  if (auth.error) return auth.error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error), { "Cache-Control": "no-store" });
  const { campaignId, ...input } = parsed.data;
  const campaign = getCampaign(campaignId);
  const project = campaign && getProjectById(campaign.projectId);
  if (!campaign || !project) return jsonError(404, "Campaign not found", { "Cache-Control": "no-store" });
  try {
    const { invite, skipped } = createInvite(project, campaign, input);
    return apiJson({ data: invite ? inviteToApi(project, invite) : null, ...(skipped ? { skipped } : {}) }, skipped ? 200 : 201);
  } catch (err) {
    if (err instanceof CampaignError) return jsonError(err.status, err.message, { "Cache-Control": "no-store" });
    throw err;
  }
}
