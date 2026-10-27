import { apiJson } from "@/lib/api-keys";
import { apiError, libError, MAX_SMALL_BYTES, projectForKey, readJson, requireApi2 } from "@/lib/api-v1";
import { createForm, listForms } from "@/lib/forms";
import { createFormBody, formToAdmin } from "@/lib/forms/admin";
import { getTemplate } from "@/lib/forms/templates";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/v1/projects/:slug/forms (API-01): the project's forms, default first, with their stats and share links. */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "read");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  return apiJson({ data: listForms(project.id).map(({ stats, ...f }) => formToAdmin(project, f, stats)) });
}

/** POST /api/v1/projects/:slug/forms (write scope): a new step-by-step form, blank or from a template, as the dashboard makes it. */
export async function POST(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "write");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  const body = await readJson(req, MAX_SMALL_BYTES);
  if (body.error) return body.error;
  const parsed = createFormBody.safeParse(body.value);
  if (!parsed.success) return apiError(400, firstIssue(parsed.error));
  const { name, slug, template } = parsed.data;
  try {
    const built = template ? getTemplate(template)!.build(project.name) : null;
    const form = createForm(project.id, {
      name,
      slug: slug || undefined,
      template,
      config: built ? { pages: built.pages, design: built.design, labels: built.labels, settings: built.settings } : undefined,
    });
    return apiJson({ data: formToAdmin(project, form) }, 201);
  } catch (err) {
    return libError(err);
  }
}
