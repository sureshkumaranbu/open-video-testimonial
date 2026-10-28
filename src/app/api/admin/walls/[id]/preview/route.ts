import { jsonError, requireRole } from "@/lib/http";
import { firstIssue } from "@/lib/validation";
import { wallConfigSchema, wallPreviewBody, wallView } from "@/lib/walls";
import { wallAndProject } from "../guard";

/**
 * The editor's preview: what the wall would show with an unsaved config
 * (the same wallView the public pages use). Drafts too, since only the
 * owner sees it. Never cached.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const parsed = wallPreviewBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const cfg = wallConfigSchema.safeParse(parsed.data.config);
  if (!cfg.success) return jsonError(400, firstIssue(cfg.error));
  const found = wallAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Wall not found");
  const { wall, project } = found;
  const data = wallView(
    {
      ...wall,
      theme: parsed.data.theme ?? wall.theme,
      featuredTestimonialId: parsed.data.featuredTestimonialId !== undefined ? parsed.data.featuredTestimonialId : wall.featuredTestimonialId,
      connectedFormId: parsed.data.connectedFormId !== undefined ? parsed.data.connectedFormId : wall.connectedFormId,
    },
    project,
    { tab: parsed.data.tab != null ? String(parsed.data.tab) : null, path: `/wall/${project.slug}/${wall.slug}`, config: cfg.data },
  );
  return Response.json({ view: data }, { headers: { "Cache-Control": "no-store" } });
}
