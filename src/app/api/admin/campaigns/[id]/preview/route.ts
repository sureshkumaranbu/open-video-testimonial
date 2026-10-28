import { z } from "zod";
import { draftContent, previewCampaign } from "@/lib/campaigns";
import { jsonError, requireRole } from "@/lib/http";
import { getRequest } from "@/lib/requests";
import { firstIssue } from "@/lib/validation";
import { campaignAndProject } from "../guard";

const body = draftContent.extend({ recipientId: z.string().max(64).nullish() });

/**
 * REQ-03: the email exactly as it's sent, built by the same function as the
 * real mail, with the editor's unsaved wording. With a recipient it's their
 * own mail (without the open pixel, so previewing never counts as an open).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const found = campaignAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Campaign not found");
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const { recipientId, ...draft } = parsed.data;
  const recipient = recipientId ? getRequest(recipientId) : null;
  if (recipientId && recipient?.campaignId !== found.campaign.id) return jsonError(404, "Recipient not found");
  const mail = previewCampaign(found.project, found.campaign, draft, { recipient });
  return Response.json({ preview: { from: mail.from, replyTo: mail.replyTo ?? null, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html } });
}
