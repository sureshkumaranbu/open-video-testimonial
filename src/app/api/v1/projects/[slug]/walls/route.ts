import { apiJson } from "@/lib/api-keys";
import { apiError, libError, MAX_SMALL_BYTES, projectForKey, readJson, requireApi2, wallToApi } from "@/lib/api-v1";
import { firstIssue } from "@/lib/validation";
import { createWall, createWallBody, listWalls } from "@/lib/walls";

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/v1/projects/:slug/walls (API-01): the project's walls, oldest first. */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "read");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  return apiJson({ data: listWalls(project.id).map((w) => wallToApi(w, project)) });
}

/** POST /api/v1/projects/:slug/walls (write scope): a new wall, as a draft. */
export async function POST(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "write");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  const body = await readJson(req, MAX_SMALL_BYTES);
  if (body.error) return body.error;
  const parsed = createWallBody.safeParse(body.value);
  if (!parsed.success) return apiError(400, firstIssue(parsed.error));
  try {
    return apiJson({ data: wallToApi(createWall(project, parsed.data), project) }, 201);
  } catch (err) {
    return libError(err);
  }
}
