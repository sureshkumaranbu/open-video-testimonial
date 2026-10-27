import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { WEBHOOK_EVENTS } from "@/db/schema";
import { newSecret, parseEvents } from "./webhooks";

const { webhooks, forms } = schema;

/** The project a form belongs to, or undefined when there's no such form. */
function formProject(formId: string) {
  return getDb().select({ projectId: forms.projectId }).from(forms).where(eq(forms.id, formId)).get()?.projectId;
}

// No defaults here: a partial update must only touch the fields it names.
const webhookFields = z.object({
  url: z
    .url({ protocol: /^https?$/, error: "Use an http:// or https:// URL" })
    .max(2000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).max(WEBHOOK_EVENTS.length),
  projectId: z.string().max(64).nullable(),
  /** Only this form's testimonials (FORM-10); the hook then belongs to the form's project. */
  formId: z
    .string()
    .max(64)
    .nullable()
    .refine((id) => id === null || formProject(id) !== undefined, "Unknown form"),
  active: z.boolean(),
});

/** A form's hook can't be set on another project. */
function sameProject(v: { projectId?: string | null; formId?: string | null }, ctx: z.RefinementCtx) {
  if (!v.formId || !v.projectId) return;
  const owner = formProject(v.formId);
  if (owner !== undefined && owner !== v.projectId) {
    ctx.addIssue({ code: "custom", path: ["formId"], message: "That form belongs to another project" });
  }
}

export const webhookSchema = webhookFields
  .extend({
    events: webhookFields.shape.events.default([]),
    projectId: webhookFields.shape.projectId.default(null),
    formId: webhookFields.shape.formId.default(null),
    active: webhookFields.shape.active.default(true),
  })
  .superRefine(sameProject);

export const webhookPatchSchema = webhookFields
  .partial()
  .extend({ rotateSecret: z.boolean().optional() })
  .superRefine(sameProject);

export function listWebhooks() {
  return getDb()
    .select()
    .from(webhooks)
    .orderBy(desc(webhooks.createdAt))
    .all()
    .map((w) => ({ ...w, events: parseEvents(w.events) }));
}

export function getWebhook(id: string) {
  return getDb().select().from(webhooks).where(eq(webhooks.id, id)).get() ?? null;
}

export function createWebhook(input: z.infer<typeof webhookSchema>) {
  return getDb()
    .insert(webhooks)
    .values({
      id: crypto.randomUUID(),
      url: input.url,
      secret: newSecret(),
      events: JSON.stringify(input.events),
      projectId: input.formId ? (formProject(input.formId) ?? input.projectId) : input.projectId,
      formId: input.formId,
      active: input.active,
      createdAt: new Date(),
    })
    .returning()
    .get();
}

export function updateWebhook(id: string, patch: z.infer<typeof webhookPatchSchema>) {
  const { events, rotateSecret, ...given } = patch;
  // Only keys present in the request are written.
  const rest: Partial<typeof webhooks.$inferInsert> = Object.fromEntries(
    Object.entries(given).filter(([, v]) => v !== undefined),
  );
  if (rest.formId) {
    rest.projectId = formProject(rest.formId) ?? rest.projectId;
  } else if (rest.projectId !== undefined && rest.formId === undefined) {
    // Moving a form's hook to another project (or to every project) lets go of the form.
    const hook = getWebhook(id);
    if (hook?.formId && formProject(hook.formId) !== rest.projectId) rest.formId = null;
  }
  return (
    getDb()
      .update(webhooks)
      .set({
        ...rest,
        ...(events ? { events: JSON.stringify(events) } : {}),
        ...(rotateSecret ? { secret: newSecret() } : {}),
      })
      .where(eq(webhooks.id, id))
      .returning()
      .get() ?? null
  );
}

export function deleteWebhook(id: string) {
  return getDb().delete(webhooks).where(eq(webhooks.id, id)).returning().get() ?? null;
}
