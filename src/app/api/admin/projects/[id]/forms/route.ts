import { createForm, FormError, listForms } from "@/lib/forms";
import { createFormBody, formToAdmin } from "@/lib/forms/admin";
import { surveyPages } from "@/lib/forms/survey";
import { getTemplate } from "@/lib/forms/templates";
import { auditRequest } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** The project's forms (default first) with their stats and share links. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  return Response.json({ forms: listForms(project.id).map(({ stats, ...f }) => formToAdmin(project, f, stats)) });
}

/** A new step-by-step form, blank (from the project's question) or from a template, or (NPS-01) a survey, made paused. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const parsed = createFormBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const { name, slug, template, kind, survey } = parsed.data;
  try {
    const built = template && kind !== "survey" ? getTemplate(template)!.build(project.name) : null;
    const form = createForm(project.id, {
      name,
      slug: slug || undefined,
      template: kind === "survey" ? undefined : template,
      kind,
      config: built
        ? { pages: built.pages, design: built.design, labels: built.labels, settings: built.settings }
        : kind === "survey"
          ? { pages: surveyPages(project.name, survey) }
          : undefined,
    });
    if (kind === "survey") auditRequest(req, "form.survey_create", { objectType: "form", objectId: form.id, projectId: project.id, summary: `Made the survey “${form.name}”` });
    return Response.json({ form: formToAdmin(project, form) }, { status: 201 });
  } catch (err) {
    if (err instanceof FormError) return jsonError(err.status, err.message);
    throw err;
  }
}
