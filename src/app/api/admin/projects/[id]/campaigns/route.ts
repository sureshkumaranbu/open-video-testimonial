import { CampaignError, campaignToAdmin, createCampaign, createCampaignBody, funnelsFor, listCampaigns } from "@/lib/campaigns";
import { jsonError, requireAdmin } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** REQ-01: the project's campaigns, newest first, each with its funnel. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const list = listCampaigns(project.id);
  const funnels = funnelsFor(project.id, list);
  return Response.json({ campaigns: list.map((c) => campaignToAdmin(c, funnels.get(c.id))) });
}

/** A new campaign, as a draft with our default wording. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const parsed = createCampaignBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    return Response.json({ campaign: campaignToAdmin(createCampaign(project, parsed.data)) }, { status: 201 });
  } catch (err) {
    if (err instanceof CampaignError) return jsonError(err.status, err.message);
    throw err;
  }
}
