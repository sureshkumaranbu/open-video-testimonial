import type { Tx } from "@/db";
import type { Form, FormStatus, Project, Testimonial } from "@/db/schema";
import type { AutoApproveRule, FormPatch } from "./schema";

/**
 * Forms: many per project, one of them the default (plan §2.4, §3.1).
 * Contract published by WP1.1 so other packages can build against it; WP1.2
 * owns and implements it. Nothing calls these yet.
 */

export type FormStats = { submissions: number; invites: number; responded: number; responseRate: number };

const todo = (fn: string): never => {
  throw new Error(`not implemented: ${fn}`);
};

export function listForms(projectId: string): (Form & { stats: FormStats })[] {
  return todo("listForms");
}

export function getForm(id: string): Form | null {
  return todo("getForm");
}

/** Follows slug_redirects: `redirectedFrom` is the old slug when it did. */
export function getFormBySlug(projectId: string, slug: string): { form: Form; redirectedFrom?: string } | null {
  return todo("getFormBySlug");
}

/** Race-safe: inserts with onConflictDoNothing on the one-default-per-project index, then reads. */
export function ensureDefaultForm(project: Project, tx?: Tx): Form {
  return todo("ensureDefaultForm");
}

/** The default form, hydrated from the project columns the first time (config_version 0 → 1, idempotent). */
export function getDefaultForm(projectId: string): Form {
  return todo("getDefaultForm");
}

export function createForm(projectId: string, i: { name: string; slug?: string; template?: string }): Form {
  return todo("createForm");
}

/** On the default form it also rewrites the mirrored project columns; it keeps autoApprove.since up to date. */
export function updateForm(id: string, patch: FormPatch, o?: { by?: string }): Form | null {
  return todo("updateForm");
}

export function duplicateForm(id: string): Form | null {
  return todo("duplicateForm");
}

/** Refuses the default form. Its testimonials keep their rows (form_id becomes NULL); its logo is deleted. */
export async function deleteForm(id: string): Promise<boolean> {
  return todo("deleteForm");
}

export function setDefaultForm(projectId: string, formId: string): void {
  todo("setDefaultForm");
}

/** Writes a slug_redirects row for the old slug. */
export function changeFormSlug(id: string, slug: string): Form {
  return todo("changeFormSlug");
}

export function setFormStatus(id: string, s: FormStatus): Form {
  return todo("setFormStatus");
}

/** classic → steps (D1); the config is kept. */
export function upgradeToSteps(id: string): Form {
  return todo("upgradeToSteps");
}

/** A classic default form lives at /c/<project>; everything else at /f/<project>/<form>. */
export function formUrl(project: Pick<Project, "slug">, form: Pick<Form, "slug" | "isDefault" | "layout">): string {
  return todo("formUrl");
}

/** The auto-approve rule for a testimonial: its form's, or the default form's when it has none. */
export function autoApproveRuleFor(t: Pick<Testimonial, "formId" | "projectId">): AutoApproveRule {
  return todo("autoApproveRuleFor");
}
