import { auditRequest } from "@/lib/audit";
import { createTrigger, createTriggerBody, listTriggers, TriggerError, triggerToAdmin } from "@/lib/campaign-triggers";
import { jsonError, requireRole } from "@/lib/http";
import { firstIssue } from "@/lib/validation";
import { campaignAndProject } from "../guard";

type Ctx = { params: Promise<{ id: string }> };

/** REQ-07: the campaign's Stripe and Shopify triggers, without their secrets. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const found = campaignAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Campaign not found");
  return Response.json({ triggers: listTriggers(found.campaign.id).map(triggerToAdmin) });
}

/** `{provider, events?, delayDays?, secret?}`: a new trigger; its endpoint URL is in the answer. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const found = campaignAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Campaign not found");
  const parsed = createTriggerBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    const t = createTrigger(found.campaign.id, parsed.data);
    auditRequest(req, "trigger.create", { objectType: "trigger", objectId: t.id, projectId: found.project.id, summary: `${t.provider} on ${found.campaign.name}` });
    return Response.json({ trigger: triggerToAdmin(t) }, { status: 201 });
  } catch (err) {
    if (err instanceof TriggerError) return jsonError(err.status, err.message);
    throw err;
  }
}
