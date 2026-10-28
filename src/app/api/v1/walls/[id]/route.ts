import { z } from "zod";
import { apiJson } from "@/lib/api-keys";
import { apiError, libError, MAX_CONFIG_BYTES, projectOfRow, readJson, requireApi2, wallToApi } from "@/lib/api-v1";
import { firstIssue } from "@/lib/validation";
import { changeWallSlug, deleteWall, getWall, setMainWall, updateWall, wallPatchBody, type WallConfigInput } from "@/lib/walls";

type Ctx = { params: Promise<{ id: string }> };

/** The editor's PATCH, plus the link (`slug`, the old one keeps working) and `main`, which the dashboard has as separate buttons. */
const patchBody = wallPatchBody.extend({ slug: z.string().max(64).optional(), main: z.boolean().optional() });

/** GET /api/v1/walls/:id (API-01) */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "read");
  if (auth.error) return auth.error;
  const wall = getWall((await ctx.params).id);
  const project = projectOfRow(auth.key, wall);
  if (!wall || !project) return apiError(404, "Wall not found");
  return apiJson({ data: wallToApi(wall, project) });
}

/** PATCH /api/v1/walls/:id (write scope): name, theme, published, featured testimonial, connected form, the whole config, slug and main. */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "write");
  if (auth.error) return auth.error;
  const wall = getWall((await ctx.params).id);
  const project = projectOfRow(auth.key, wall);
  if (!wall || !project) return apiError(404, "Wall not found");
  const body = await readJson(req, MAX_CONFIG_BYTES);
  if (body.error) return body.error;
  const parsed = patchBody.safeParse(body.value);
  if (!parsed.success) return apiError(400, firstIssue(parsed.error));
  const { config, slug, main, ...rest } = parsed.data;
  try {
    if (slug !== undefined && slug !== wall.slug) changeWallSlug(wall.id, slug);
    updateWall(wall.id, { ...rest, config: config as WallConfigInput | undefined });
    if (main === true) setMainWall(project.id, wall.id);
    else if (main === false && wall.isMain) setMainWall(project.id, null);
  } catch (err) {
    return libError(err);
  }
  return apiJson({ data: wallToApi(getWall(wall.id)!, project) });
}

/** DELETE /api/v1/walls/:id (write scope): if it was the main wall, the project's wall address shows the classic page again. */
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "write");
  if (auth.error) return auth.error;
  const wall = getWall((await ctx.params).id);
  if (!wall || !projectOfRow(auth.key, wall) || !(await deleteWall(wall.id))) return apiError(404, "Wall not found");
  return apiJson({ ok: true });
}
