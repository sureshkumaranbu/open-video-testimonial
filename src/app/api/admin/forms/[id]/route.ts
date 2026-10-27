import { deleteForm, setFormStatus, updateForm } from "@/lib/forms";
import { formPatchBody } from "@/lib/forms/admin";
import type { FormPatch } from "@/lib/forms/schema";
import { getRequestSession } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/http";
import { firstIssue } from "@/lib/validation";
import { formErrorResponse, formResponse, loadForm } from "./shared";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return formResponse((await ctx.params).id);
}

/**
 * Saves the builder's changes: each config part sent replaces that part whole
 * (checked in full by updateForm), plus name, language and live/paused. A
 * classic form refuses what the classic page can't show (409).
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const found = loadForm(id);
  if (found instanceof Response) return found;
  const parsed = formPatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const { status, ...patch } = parsed.data;
  try {
    if (Object.keys(patch).length) updateForm(id, patch as FormPatch, { by: getRequestSession(req)?.email });
    if (status) setFormStatus(id, status);
  } catch (err) {
    return formErrorResponse(err);
  }
  return formResponse(id);
}

/** Deletes a form; its testimonials stay (form_id becomes empty). The default form can't be deleted (409). */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    const gone = await deleteForm((await ctx.params).id);
    return gone ? Response.json({ ok: true }) : jsonError(404, "Form not found");
  } catch (err) {
    return formErrorResponse(err);
  }
}
