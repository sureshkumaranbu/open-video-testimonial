import type { Form } from "@/db/schema";
import { FormError, getForm } from "@/lib/forms";
import { formToAdmin } from "@/lib/forms/admin";
import { jsonError } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";

/** The form and its project, or the error response to send. */
export function loadForm(id: string): { form: Form; project: NonNullable<ReturnType<typeof getProjectById>> } | Response {
  const form = getForm(id);
  const project = form && getProjectById(form.projectId);
  if (!form || !project) return jsonError(404, "Form not found");
  return { form, project };
}

/** The builder's view of a form, freshly read. */
export function formResponse(id: string, status = 200) {
  const found = loadForm(id);
  if (found instanceof Response) return found;
  return Response.json({ form: formToAdmin(found.project, found.form) }, { status });
}

/** FormError → its status; anything else is rethrown. */
export function formErrorResponse(err: unknown) {
  if (err instanceof FormError) return jsonError(err.status, err.message);
  throw err;
}
