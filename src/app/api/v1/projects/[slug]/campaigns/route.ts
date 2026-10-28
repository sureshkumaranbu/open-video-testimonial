import { apiJson } from "@/lib/api-keys";
import { apiError, campaignToApi, libError, MAX_SMALL_BYTES, projectForKey, readJson, requireApi2 } from "@/lib/api-v1";
import { createCampaign, createCampaignBody, funnelsFor, listCampaigns } from "@/lib/campaigns";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/v1/projects/:slug/campaigns (API-01): newest first, each with its funnel. */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "read");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  const list = listCampaigns(project.id);
  const funnels = funnelsFor(project.id, list);
  return apiJson({ data: list.map((c) => campaignToApi(c, funnels.get(c.id))) });
}

/** POST /api/v1/projects/:slug/campaigns (write scope): a new campaign, as a draft with our default wording. */
export async function POST(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "write");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  const body = await readJson(req, MAX_SMALL_BYTES);
  if (body.error) return body.error;
  const parsed = createCampaignBody.safeParse(body.value);
  if (!parsed.success) return apiError(400, firstIssue(parsed.error));
  try {
    return apiJson({ data: campaignToApi(createCampaign(project, parsed.data)) }, 201);
  } catch (err) {
    return libError(err);
  }
}
