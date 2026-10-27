import { createForm, FormError, listForms } from "@/lib/forms";
import { createFormBody, formToAdmin } from "@/lib/forms/admin";
import { getTemplate } from "@/lib/forms/templates";
import { jsonError, requireAdmin } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** The project's forms (default first) with their stats and share links. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  return Response.json({ forms: listForms(project.id).map(({ stats, ...f }) => formToAdmin(project, f, stats)) });
}

/** A new step-by-step form, blank (from the project's question) or from a template. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const parsed = createFormBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const { name, slug, template } = parsed.data;
  try {
    const built = template ? getTemplate(template)!.build(project.name) : null;
    const form = createForm(project.id, {
      name,
      slug: slug || undefined,
      template,
      config: built ? { pages: built.pages, design: built.design, labels: built.labels, settings: built.settings } : undefined,
    });
    return Response.json({ form: formToAdmin(project, form) }, { status: 201 });
  } catch (err) {
    if (err instanceof FormError) return jsonError(err.status, err.message);
    throw err;
  }
}
