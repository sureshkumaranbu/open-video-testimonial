import { z } from "zod";
import type { Form, Project } from "@/db/schema";
import { FORM_STATUSES } from "@/db/schema";
import { env } from "@/lib/env";
import { deleteObject, removeFiles, saveUpload } from "@/lib/storage";
import { FormError, formUrl, getForm, logoInUse, updateForm, type FormStats } from "./index";
import { isLocale } from "./labels";
import { parseReward } from "@/lib/rewards-config";
import { parseFormRow, toPublicForm } from "./schema";
import { TEMPLATE_IDS } from "./templates";

/**
 * The forms admin API's request shapes and the form as the builder sees it
 * (WP2.5). The config parts are checked whole by updateForm, so these only
 * pin the outer shape.
 */

export const createFormBody = z.object({
  name: z.string().trim().min(1, "Give the form a name").max(120),
  slug: z.string().trim().max(48).optional(),
  template: z.enum(TEMPLATE_IDS).optional(),
});

export const formPatchBody = z
  .object({
    name: z.string().max(120),
    language: z.string().refine(isLocale, "Choose one of the languages offered"),
    status: z.enum(FORM_STATUSES),
    pages: z.array(z.unknown()).max(30),
    design: z.record(z.string(), z.unknown()),
    labels: z.object({
      overrides: z.record(z.string().max(40), z.string().max(500)).refine((o) => Object.keys(o).length <= 200, "Too many label changes"),
    }),
    settings: z.record(z.string(), z.unknown()),
    reward: z.record(z.string(), z.unknown()),
  })
  .partial();

export const slugBody = z.object({ slug: z.string().max(48) });

/** Absolute links and the three embed snippets for the share panel (FORM-11). */
export function shareLinks(project: Pick<Project, "slug">, form: Pick<Form, "slug" | "isDefault" | "layout" | "name">) {
  const base = env.publicUrl;
  const hosted = `${base}${formUrl(project, form)}`;
  const iframeSrc = `${base}/embed/${project.slug}/form/${form.slug}`;
  const attrs = `data-plaudit-form="${form.slug}" data-project="${project.slug}"`;
  const script = `<script src="${base}/form.js" async></script>`;
  const title = form.name.replace(/[<>&"]/g, "");
  return {
    hosted,
    inline: `<div ${attrs}></div>\n${script}`,
    popup: `<div ${attrs} data-mode="popup" data-label="Share your experience"></div>\n${script}`,
    iframe: `<iframe src="${iframeSrc}" title="${title}" allow="camera; microphone; clipboard-write" style="width:100%;border:0;min-height:640px"></iframe>`,
  };
}

/** A form as the builder and the forms list get it: the row, its parsed config, its links and (when known) its stats. */
export function formToAdmin(project: Project, form: Form, stats?: FormStats) {
  const config = parseFormRow(form);
  return {
    id: form.id,
    projectId: form.projectId,
    slug: form.slug,
    name: form.name,
    status: form.status,
    layout: form.layout,
    isDefault: form.isDefault,
    language: form.language,
    template: form.template,
    logoUrl: toPublicForm(form, config).logoUrl,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
    config,
    /** FORM-13: kept beside the config (its own column). */
    reward: parseReward(form.reward),
    links: shareLinks(project, form),
    ...(stats ? { stats } : {}),
  };
}
export type AdminForm = ReturnType<typeof formToAdmin>;

/** Stores an image (PNG, JPEG, WebP or GIF; never SVG) as the form's logo, replacing the old one. Public, like project logos. */
export async function setFormLogo(id: string, file: File): Promise<Form> {
  const existing = getForm(id);
  if (!existing) throw new FormError(404, "Form not found");
  const stored = await saveUpload(file, "image");
  const form = updateForm(id, { logoKey: stored.key });
  if (!form) {
    await deleteObject(stored.key);
    throw new FormError(404, "Form not found");
  }
  if (existing.logoKey && existing.logoKey !== stored.key && !logoInUse(existing.logoKey)) await removeFiles([existing.logoKey]);
  return form;
}

export async function removeFormLogo(id: string): Promise<Form> {
  const existing = getForm(id);
  if (!existing) throw new FormError(404, "Form not found");
  if (!existing.logoKey) return existing;
  const form = updateForm(id, { logoKey: null })!;
  if (!logoInUse(existing.logoKey)) await removeFiles([existing.logoKey]);
  return form;
}
