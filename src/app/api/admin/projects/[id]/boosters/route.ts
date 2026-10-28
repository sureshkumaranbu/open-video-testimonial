import { BoosterError, boosterToAdmin, createBooster, createBoosterBody, listBoosters } from "@/lib/boosters";
import { jsonError, requireRole } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** BOOST-01: the project's review booster pages, oldest first. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  return Response.json({ boosters: listBoosters(project.id).map((b) => boosterToAdmin(b, project)) });
}

/** A new booster page, as a draft. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const parsed = createBoosterBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    return Response.json({ booster: boosterToAdmin(createBooster(project, parsed.data), project) }, { status: 201 });
  } catch (err) {
    if (err instanceof BoosterError) return jsonError(err.status, err.message);
    throw err;
  }
}
