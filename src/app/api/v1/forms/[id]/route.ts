import { z } from "zod";
import { apiJson } from "@/lib/api-keys";
import { apiError, libError, MAX_CONFIG_BYTES, projectOfRow, readJson, requireApi2 } from "@/lib/api-v1";
import { changeFormSlug, deleteForm, getForm, setDefaultForm, setFormStatus, updateForm } from "@/lib/forms";
import { formPatchBody, formToAdmin, slugBody } from "@/lib/forms/admin";
import type { FormPatch } from "@/lib/forms/schema";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** The builder's PATCH, plus the link (`slug`, the old one keeps working) and `isDefault: true`, which the dashboard has as separate buttons. */
const patchBody = formPatchBody.extend({ slug: slugBody.shape.slug.optional(), isDefault: z.literal(true).optional() });

/** GET /api/v1/forms/:id (API-01): the form as the builder sees it, with its links. */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "read");
  if (auth.error) return auth.error;
  const form = getForm((await ctx.params).id);
  const project = projectOfRow(auth.key, form);
  if (!form || !project) return apiError(404, "Form not found");
  return apiJson({ data: formToAdmin(project, form) });
}

/**
 * PATCH /api/v1/forms/:id (write scope): name, language, live or paused,
 * and whole config parts (pages, design, labels, settings, reward), checked
 * exactly as the builder's save is. A classic form refuses what the classic
 * page can't show (409).
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "write");
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  const form = getForm(id);
  const project = projectOfRow(auth.key, form);
  if (!form || !project) return apiError(404, "Form not found");
  const body = await readJson(req, MAX_CONFIG_BYTES);
  if (body.error) return body.error;
  const parsed = patchBody.safeParse(body.value);
  if (!parsed.success) return apiError(400, firstIssue(parsed.error));
  const { status, slug, isDefault, ...patch } = parsed.data;
  try {
    if (slug !== undefined && slug !== form.slug) changeFormSlug(id, slug);
    if (Object.keys(patch).length) updateForm(id, patch as FormPatch, { by: "api" });
    if (status) setFormStatus(id, status);
    if (isDefault) setDefaultForm(project.id, id);
  } catch (err) {
    return libError(err);
  }
  return apiJson({ data: formToAdmin(project, getForm(id)!) });
}

/** DELETE /api/v1/forms/:id (write scope): its testimonials stay. The default form can't be deleted (409). */
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "write");
  if (auth.error) return auth.error;
  const form = getForm((await ctx.params).id);
  if (!form || !projectOfRow(auth.key, form)) return apiError(404, "Form not found");
  try {
    if (!(await deleteForm(form.id))) return apiError(404, "Form not found");
  } catch (err) {
    return libError(err);
  }
  return apiJson({ ok: true });
}
