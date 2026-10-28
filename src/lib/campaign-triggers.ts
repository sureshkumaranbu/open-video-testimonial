import crypto from "node:crypto";
import { and, asc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { CampaignTrigger, TriggerProvider } from "@/db/schema";
import { TRIGGER_PROVIDERS } from "@/db/schema";
import { env } from "./env";
import { registerPeriodic } from "./jobs";

const { campaignTriggers, triggerEvents } = schema;

/**
 * REQ-07 native triggers (M14): Stripe and Shopify call
 * /api/hooks/<provider>/<trigger id> after a sale, and the buyer gets the
 * campaign's invitation, `delay_days` later. The URL isn't secret: every
 * delivery must carry the provider's signature over the raw body, made with
 * the signing secret the owner pasted from Stripe or Shopify. That secret is
 * stored (it's needed in full to check signatures) and never sent back.
 */

/** The events each provider's trigger can act on; the first ones are on by default. */
export const TRIGGER_EVENTS: Record<TriggerProvider, readonly string[]> = {
  stripe: ["checkout.session.completed", "invoice.paid"],
  shopify: ["orders/fulfilled", "orders/paid"],
};
const DEFAULT_EVENTS: Record<TriggerProvider, string[]> = { stripe: ["checkout.session.completed", "invoice.paid"], shopify: ["orders/fulfilled"] };

/** Stripe's default tolerance for a signature's timestamp. */
export const STRIPE_TOLERANCE_S = 300;
/** Deliveries remembered for de-duplication; providers retry for at most a few days. */
const SEEN_DAYS = 30;

const secret = z.string().trim().min(8, "Paste the signing secret from Stripe or Shopify").max(500);
const delayDays = z.number().int("Whole days").min(0).max(365);
const events = z.array(z.string().max(60)).min(1, "Choose at least one event").max(5);

export const createTriggerBody = z.object({ provider: z.enum(TRIGGER_PROVIDERS), events: events.optional(), delayDays: delayDays.default(0), secret: secret.optional() });
export const triggerPatchBody = z.object({ events, delayDays, secret, enabled: z.boolean() }).partial();

export class TriggerError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function checkEvents(provider: TriggerProvider, list: string[]) {
  const bad = list.find((e) => !TRIGGER_EVENTS[provider].includes(e));
  if (bad) throw new TriggerError(400, `${provider === "stripe" ? "Stripe" : "Shopify"} triggers act on ${TRIGGER_EVENTS[provider].join(" or ")}, not ${bad}`);
  return [...new Set(list)];
}

export function listTriggers(campaignId: string) {
  return getDb().select().from(campaignTriggers).where(eq(campaignTriggers.campaignId, campaignId)).orderBy(asc(campaignTriggers.createdAt)).all();
}

export function getTrigger(id: string) {
  return getDb().select().from(campaignTriggers).where(eq(campaignTriggers.id, id)).get() ?? null;
}

export function createTrigger(campaignId: string, input: z.infer<typeof createTriggerBody>) {
  if (listTriggers(campaignId).length >= 10) throw new TriggerError(409, "A campaign can have up to 10 triggers");
  const now = new Date();
  return getDb()
    .insert(campaignTriggers)
    .values({
      id: crypto.randomUUID(),
      campaignId,
      provider: input.provider,
      events: JSON.stringify(checkEvents(input.provider, input.events ?? DEFAULT_EVENTS[input.provider])),
      delayDays: input.delayDays,
      secret: input.secret ?? "",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function updateTrigger(t: CampaignTrigger, patch: z.infer<typeof triggerPatchBody>) {
  return getDb()
    .update(campaignTriggers)
    .set({
      ...(patch.events ? { events: JSON.stringify(checkEvents(t.provider, patch.events)) } : {}),
      ...(patch.delayDays !== undefined ? { delayDays: patch.delayDays } : {}),
      ...(patch.secret !== undefined ? { secret: patch.secret } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(campaignTriggers.id, t.id))
    .returning()
    .get();
}

export function deleteTrigger(id: string) {
  return getDb().delete(campaignTriggers).where(eq(campaignTriggers.id, id)).returning().get() ?? null;
}

export const triggerUrl = (t: Pick<CampaignTrigger, "id" | "provider">) => `${env.publicUrl}/api/hooks/${t.provider}/${t.id}`;

const parseEvents = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((e) => typeof e === "string") : [];
  } catch {
    return [];
  }
};

/** A trigger as the campaign page shows it: never its secret. */
export function triggerToAdmin(t: CampaignTrigger) {
  return {
    id: t.id,
    campaignId: t.campaignId,
    provider: t.provider,
    events: parseEvents(t.events),
    delayDays: t.delayDays,
    enabled: t.enabled,
    secretSet: t.secret.length > 0,
    url: triggerUrl(t),
    lastEventAt: t.lastEventAt?.toISOString() ?? null,
    lastResult: t.lastResult,
    createdAt: t.createdAt.toISOString(),
  };
}
export type AdminTrigger = ReturnType<typeof triggerToAdmin>;

// ------------------------------------------------------------------ signatures

const equal = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Stripe-Signature: `t=<unix seconds>,v1=<hex>[,v1=…]`, where v1 is
 * HMAC-SHA256(secret, `${t}.${raw body}`). Any v1 may match (Stripe sends
 * two while a secret is being rolled); the timestamp must be within 5 minutes.
 */
export function verifyStripe(secretKey: string, header: string, raw: string, now = Date.now()) {
  const parts = header.split(",").map((p) => p.trim().split("=", 2) as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > STRIPE_TOLERANCE_S) return false;
  const expected = crypto.createHmac("sha256", secretKey).update(`${t}.${raw}`).digest("hex");
  return parts.some(([k, v]) => k === "v1" && typeof v === "string" && equal(v, expected));
}

/** X-Shopify-Hmac-Sha256: base64 HMAC-SHA256(secret, raw body). */
export function verifyShopify(secretKey: string, header: string, raw: string) {
  const expected = crypto.createHmac("sha256", secretKey).update(raw, "utf8").digest("base64");
  return equal(header.trim(), expected);
}

/** For tests and docs: the header Stripe would send. */
export function stripeSignature(secretKey: string, raw: string, now = Date.now()) {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${crypto.createHmac("sha256", secretKey).update(`${t}.${raw}`).digest("hex")}`;
}

// ------------------------------------------------------------------ who bought

type Person = { email: string; name?: string; company?: string };
const str = (v: unknown, max = 254) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/**
 * The buyer from a Stripe event: a Checkout Session that's paid (not one
 * still waiting for a bank transfer), or a paid invoice.
 */
export function personFromStripe(event: { type?: unknown; data?: { object?: Record<string, unknown> } }): Person | { skip: string } {
  const o = event.data?.object ?? {};
  if (event.type === "checkout.session.completed") {
    if (o.payment_status !== "paid" && o.payment_status !== "no_payment_required") return { skip: "not paid yet" };
    const d = (o.customer_details ?? {}) as Record<string, unknown>;
    const email = str(d.email) ?? str(o.customer_email);
    return email ? { email, name: str(d.name, 120) } : { skip: "no email address" };
  }
  if (event.type === "invoice.paid") {
    const email = str(o.customer_email);
    return email ? { email, name: str(o.customer_name, 120) } : { skip: "no email address" };
  }
  return { skip: "another event" };
}

/** The buyer from a Shopify order. */
export function personFromShopify(order: Record<string, unknown>): Person | { skip: string } {
  const c = (order.customer ?? {}) as Record<string, unknown>;
  const billing = (order.billing_address ?? {}) as Record<string, unknown>;
  const email = str(order.email) ?? str(order.contact_email) ?? str(c.email);
  if (!email) return { skip: "no email address" };
  const name = [str(c.first_name, 60), str(c.last_name, 60)].filter(Boolean).join(" ") || str(billing.name, 120);
  return { email, name: name || undefined, company: str(billing.company, 120) };
}

/** Notes a delivery as handled; false if it already was (a provider retrying). */
export function firstDelivery(triggerId: string, externalId: string, now = new Date()) {
  return getDb().insert(triggerEvents).values({ triggerId, externalId: externalId.slice(0, 200), receivedAt: now }).onConflictDoNothing().run().changes === 1;
}

/** Undoes firstDelivery when the invite couldn't be made, so the provider's retry is handled. */
export function forgetDelivery(triggerId: string, externalId: string) {
  getDb()
    .delete(triggerEvents)
    .where(and(eq(triggerEvents.triggerId, triggerId), eq(triggerEvents.externalId, externalId.slice(0, 200))))
    .run();
}

export function noteResult(id: string, result: string, now = new Date()) {
  getDb().update(campaignTriggers).set({ lastEventAt: now, lastResult: result.slice(0, 300) }).where(eq(campaignTriggers.id, id)).run();
}

export function registerTriggerJobs() {
  registerPeriodic("triggers.forget", 24 * 60 * 60 * 1000, () => {
    getDb()
      .delete(triggerEvents)
      .where(lt(triggerEvents.receivedAt, new Date(Date.now() - SEEN_DAYS * 86_400_000)))
      .run();
  });
}

export { parseEvents as triggerEventsOf };
