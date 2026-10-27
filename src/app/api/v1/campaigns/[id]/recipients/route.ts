import { apiJson } from "@/lib/api-keys";
import { apiError, MAX_RECIPIENTS_BYTES, pageParams, pagination, projectOfRow, readJson, requireApi2 } from "@/lib/api-v1";
import { addRecipients, getCampaign, MAX_IMPORT_ROWS, recipientRows, recipientsBody } from "@/lib/campaigns";
import { inviteToApi, listRequests } from "@/lib/requests";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/campaigns/:id/recipients?limit=&offset= (API-01): newest first, each with how far they got. */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "read");
  if (auth.error) return auth.error;
  const campaign = getCampaign((await ctx.params).id);
  const project = projectOfRow(auth.key, campaign);
  if (!campaign || !project) return apiError(404, "Campaign not found");
  const page = pageParams(new URL(req.url).searchParams);
  if (page instanceof Response) return page;
  const all = listRequests(project.id, { campaignId: campaign.id });
  return apiJson({
    data: all.slice(page.offset, page.offset + page.limit).map((r) => inviteToApi(project, r)),
    pagination: pagination(all.length, page.limit, page.offset),
  });
}

/**
 * POST /api/v1/campaigns/:id/recipients (write scope): adds people as the
 * dashboard does (`source`: paste, customers or manual). On an active
 * campaign their invitations are queued at once. Skipped rows come back with
 * the reason (invalid, duplicate, unsubscribed, responded).
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "write");
  if (auth.error) return auth.error;
  const campaign = getCampaign((await ctx.params).id);
  const project = projectOfRow(auth.key, campaign);
  if (!campaign || !project) return apiError(404, "Campaign not found");
  const body = await readJson(req, MAX_RECIPIENTS_BYTES);
  if (body.error) return body.error;
  const parsed = recipientsBody.safeParse(body.value);
  if (!parsed.success) return apiError(400, firstIssue(parsed.error));
  const rows = recipientRows(project, parsed.data);
  if (rows.length === 0) return apiError(400, parsed.data.source === "customers" ? "None of those customers has an email address" : "No people found in that text");
  if (rows.length > MAX_IMPORT_ROWS) return apiError(400, `Add at most ${MAX_IMPORT_ROWS.toLocaleString("en")} people at a time`);
  const { created, skipped } = addRecipients(project, campaign, rows);
  return apiJson({ data: created.map((r) => inviteToApi(project, r)), skipped, rows: rows.length }, 201);
}
