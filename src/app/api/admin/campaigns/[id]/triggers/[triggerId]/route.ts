import { auditRequest } from "@/lib/audit";
import { deleteTrigger, getTrigger, TriggerError, triggerPatchBody, triggerToAdmin, updateTrigger } from "@/lib/campaign-triggers";
import { jsonError, requireRole } from "@/lib/http";
import { firstIssue } from "@/lib/validation";
import { campaignAndProject } from "../../guard";

type Ctx = { params: Promise<{ id: string; triggerId: string }> };

async function load(ctx: Ctx) {
  const { id, triggerId } = await ctx.params;
  const found = campaignAndProject(id);
  const t = getTrigger(triggerId);
  return found && t && t.campaignId === found.campaign.id ? { ...found, trigger: t } : null;
}

/** Events, delay, on or off, and a new signing secret (it's never sent back). */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const found = await load(ctx);
  if (!found) return jsonError(404, "Trigger not found");
  const parsed = triggerPatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    const t = updateTrigger(found.trigger, parsed.data);
    auditRequest(req, "trigger.update", {
      objectType: "trigger",
      objectId: t.id,
      projectId: found.project.id,
      summary: `${t.provider} on ${found.campaign.name}`,
      meta: { fields: Object.keys(parsed.data) },
    });
    return Response.json({ trigger: triggerToAdmin(t) });
  } catch (err) {
    if (err instanceof TriggerError) return jsonError(err.status, err.message);
    throw err;
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const found = await load(ctx);
  if (!found) return jsonError(404, "Trigger not found");
  deleteTrigger(found.trigger.id);
  auditRequest(req, "trigger.delete", { objectType: "trigger", objectId: found.trigger.id, projectId: found.project.id, summary: `${found.trigger.provider} on ${found.campaign.name}` });
  return Response.json({ ok: true });
}
