import { apiJson } from "@/lib/api-keys";
import { audit, keyActor } from "@/lib/audit";
import { apiError, libError, MAX_SMALL_BYTES, projectForKey, readJson, requireApi2 } from "@/lib/api-v1";
import { deleteTag, listTagUsage, mergeTags, renameTag, tagDeleteBody, tagsPatchBody } from "@/lib/projects";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/v1/projects/:slug/tags (API-01): every tag, with how many testimonials have it. */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "read");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  return apiJson({ data: listTagUsage(project.id) });
}

/** PATCH /api/v1/projects/:slug/tags (write scope): `{action: "rename", from, to}` or `{action: "merge", from: […], into}`, on every testimonial at once. */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "write");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  const body = await readJson(req, MAX_SMALL_BYTES);
  if (body.error) return body.error;
  const parsed = tagsPatchBody.safeParse(body.value);
  if (!parsed.success) return apiError(400, firstIssue(parsed.error));
  const c = parsed.data;
  try {
    if (c.action === "rename") renameTag(project.id, c.from, c.to, { by: "api" });
    else mergeTags(project.id, c.from, c.into, { by: "api" });
  } catch (err) {
    return libError(err);
  }
  audit(keyActor(auth.key), "tag.change", { objectType: "project", objectId: project.id, projectId: project.id, meta: c });
  return apiJson({ data: listTagUsage(project.id) });
}

/** DELETE /api/v1/projects/:slug/tags?name=… (write scope): removes the tag from every testimonial and from the project. */
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "write");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  const parsed = tagDeleteBody.safeParse({ name: new URL(req.url).searchParams.get("name") ?? undefined });
  if (!parsed.success) return apiError(400, "Say which tag: ?name=…");
  try {
    deleteTag(project.id, parsed.data.name, { by: "api" });
  } catch (err) {
    return libError(err);
  }
  return apiJson({ data: listTagUsage(project.id) });
}
