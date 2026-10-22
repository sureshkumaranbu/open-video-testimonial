import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { WEBHOOK_EVENTS } from "@/db/schema";
import { newSecret, parseEvents } from "./webhooks";

const { webhooks } = schema;

export const webhookSchema = z.object({
  url: z
    .url({ protocol: /^https?$/, error: "Use an http:// or https:// URL" })
    .max(2000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).max(WEBHOOK_EVENTS.length).default([]),
  projectId: z.string().max(64).nullable().default(null),
  active: z.boolean().default(true),
});

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
      projectId: input.projectId,
      active: input.active,
      createdAt: new Date(),
    })
    .returning()
    .get();
}

export function updateWebhook(id: string, patch: Partial<z.infer<typeof webhookSchema>> & { rotateSecret?: boolean }) {
  const { events, rotateSecret, ...rest } = patch;
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
