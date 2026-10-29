import crypto from "node:crypto";
import { and, count, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Purchase, StripeConnection, Testimonial } from "@/db/schema";
import { env } from "../env";
import { featureOn } from "../features";
import { registerPeriodic } from "../jobs";
import { getConnection } from "./stripe-connection";

const { purchases, stripeConnections, testimonials } = schema;

/**
 * INT-07 (M18): purchases from a project's Stripe connection. What's kept is
 * what the sales popup may show (first name, a city or country, the product,
 * the amount, the time) plus a keyed hash of the buyer's email for
 * "Verified purchase". The email itself, the last name, the full address and
 * every card detail are read from the event and dropped. Rows are deleted
 * after the connection's retention (90 days by default).
 */

/** The email as matched: trimmed and lower case. */
const normalEmail = (email: string) => email.trim().toLowerCase();

/**
 * A keyed hash of an email (HMAC-SHA256 with a key derived from
 * SESSION_SECRET), so a purchase can be matched to a testimonial without the
 * address being stored. Changing SESSION_SECRET stops older purchases matching.
 */
export function emailHash(email: string): string {
  return crypto.createHmac("sha256", env.sessionSecret).update(`purchase-email:${normalEmail(email)}`).digest("hex");
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** "Ada Lovelace" → "Ada". Only the first word ever leaves this function. */
export function firstNameOf(name: unknown): string | null {
  const full = str(name, 200);
  if (!full) return null;
  const first = full.split(" ")[0].replace(/[^\p{L}\p{M}'’.-]/gu, "");
  return first ? first.slice(0, 40) : null;
}

let regions: Intl.DisplayNames | null = null;
/** "GB" → "United Kingdom"; null for anything that isn't a country code. */
export function countryName(code: unknown): string | null {
  const c = str(code, 2);
  if (!c || !/^[A-Za-z]{2}$/.test(c)) return null;
  try {
    regions ??= new Intl.DisplayNames(["en"], { type: "region" });
    const name = regions.of(c.toUpperCase());
    return name && name !== c.toUpperCase() ? name : null;
  } catch {
    return null;
  }
}

/** The city, else the country's name. Never the street, postcode or region. */
function placeOf(address: unknown): string | null {
  const a = obj(address);
  return str(a.city, 60) ?? countryName(a.country);
}

/** An invoice line's description without Stripe's quantity and price: "1 × Pro plan (at £29.00 / month)" → "Pro plan". */
export function productFromDescription(d: unknown): string | null {
  const s = str(d, 200);
  if (!s) return null;
  const clean = s
    .replace(/^\d+\s*[×x]\s*/u, "")
    .replace(/\s*\(at [^)]*\)\s*$/i, "")
    .trim();
  return clean ? clean.slice(0, 80) : null;
}

/** What a Stripe event's metadata may name the product as (Payment Links and Checkout don't send line items). */
function productFromMetadata(m: unknown): string | null {
  const meta = obj(m);
  return str(meta.product_name, 80) ?? str(meta.plaudit_product, 80) ?? str(meta.product, 80);
}

export type PurchaseFacts = {
  externalId: string;
  eventType: string;
  firstName: string | null;
  place: string | null;
  product: string | null;
  amount: number | null;
  currency: string | null;
  /** Read from the event to make the hash and to mark testimonials; never stored. */
  email: string | null;
  purchasedAt: Date;
};

const amountOf = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e12 ? v : null);
const currencyOf = (v: unknown) => (typeof v === "string" && /^[a-z]{3}$/i.test(v) ? v.toLowerCase() : null);

/**
 * The facts a purchase event carries: a paid Checkout Session or a paid
 * invoice. `{ skip }` for anything else, or a session still waiting for payment.
 */
export function purchaseFromStripe(event: unknown): PurchaseFacts | { skip: string } {
  const e = obj(event);
  const o = obj(obj(e.data).object);
  const id = typeof e.id === "string" ? e.id.slice(0, 200) : null;
  if (!id) return { skip: "no event id" };
  const created = typeof e.created === "number" && e.created > 0 ? new Date(e.created * 1000) : new Date();
  const purchasedAt = created.getTime() > Date.now() ? new Date() : created;
  if (e.type === "checkout.session.completed") {
    if (o.payment_status !== "paid" && o.payment_status !== "no_payment_required") return { skip: "not paid yet" };
    const d = obj(o.customer_details);
    const items = obj(o.line_items).data;
    const firstLine = Array.isArray(items) ? obj(items[0]) : {};
    return {
      externalId: id,
      eventType: e.type,
      firstName: firstNameOf(d.name),
      place: placeOf(d.address),
      product: productFromMetadata(o.metadata) ?? productFromDescription(firstLine.description),
      amount: amountOf(o.amount_total),
      currency: currencyOf(o.currency),
      email: str(d.email, 254) ?? str(o.customer_email, 254),
      purchasedAt,
    };
  }
  if (e.type === "invoice.paid") {
    const lines = obj(o.lines).data;
    const firstLine = Array.isArray(lines) ? obj(lines[0]) : {};
    return {
      externalId: id,
      eventType: e.type,
      firstName: firstNameOf(o.customer_name),
      place: placeOf(o.customer_address),
      product: productFromMetadata(o.metadata) ?? productFromMetadata(firstLine.metadata) ?? productFromDescription(firstLine.description),
      amount: amountOf(o.amount_paid),
      currency: currencyOf(o.currency),
      email: str(o.customer_email, 254),
      purchasedAt,
    };
  }
  return { skip: `not acting on ${typeof e.type === "string" ? e.type.slice(0, 60) : "this event"}` };
}

/**
 * Records a purchase once (a retried delivery is a duplicate), and marks the
 * project's testimonials from the same email as "Verified purchase" when the
 * connection says so. Returns null for a duplicate.
 */
export function recordPurchase(c: Pick<StripeConnection, "projectId" | "verifyPurchases">, f: PurchaseFacts): { purchase: Purchase; marked: number } | null {
  const db = getDb();
  const hash = f.email ? emailHash(f.email) : null;
  const purchase = db
    .insert(purchases)
    .values({
      id: crypto.randomUUID(),
      projectId: c.projectId,
      externalId: f.externalId,
      eventType: f.eventType,
      firstName: f.firstName,
      place: f.place,
      product: f.product,
      amount: f.amount,
      currency: f.currency,
      emailHash: hash,
      purchasedAt: f.purchasedAt,
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .returning()
    .get();
  if (!purchase) return null;
  let marked = 0;
  if (c.verifyPurchases && f.email) {
    marked = db
      .update(testimonials)
      .set({ verifiedPurchaseAt: new Date() })
      .where(and(eq(testimonials.projectId, c.projectId), isNull(testimonials.verifiedPurchaseAt), sql`lower(trim(${testimonials.authorEmail})) = ${normalEmail(f.email)}`))
      .run().changes;
  }
  return { purchase, marked };
}

/** Whether a purchase from this email is on record for the project (within its retention). */
export function hasPurchase(projectId: string, email: string): boolean {
  return Boolean(
    getDb()
      .select({ id: purchases.id })
      .from(purchases)
      .where(and(eq(purchases.projectId, projectId), eq(purchases.emailHash, emailHash(email))))
      .get(),
  );
}

/**
 * A new testimonial from someone who bought: marks it "Verified purchase".
 * Called for every testimonial.created; cheap when there's no connection.
 */
export function markIfPurchased(t: Pick<Testimonial, "id" | "projectId" | "authorEmail" | "verifiedPurchaseAt">): boolean {
  if (!featureOn("commerce") || !t.authorEmail || t.verifiedPurchaseAt) return false;
  const c = getConnection(t.projectId);
  if (!c || !c.verifyPurchases || !hasPurchase(t.projectId, t.authorEmail)) return false;
  getDb().update(testimonials).set({ verifiedPurchaseAt: new Date() }).where(eq(testimonials.id, t.id)).run();
  return true;
}

/** Sets or clears a testimonial's mark by hand; setting it needs a matching purchase on record. */
export function setVerifiedPurchase(t: Pick<Testimonial, "id" | "projectId" | "authorEmail">, verified: boolean): boolean {
  if (verified && !(t.authorEmail && hasPurchase(t.projectId, t.authorEmail))) return false;
  getDb()
    .update(testimonials)
    .set({ verifiedPurchaseAt: verified ? new Date() : null })
    .where(eq(testimonials.id, t.id))
    .run();
  return true;
}

/** The newest purchases within `days` (and the retention), for the popup and the dashboard. */
export function recentPurchases(projectId: string, o: { days?: number; limit?: number } = {}): Purchase[] {
  const c = getConnection(projectId);
  const keep = c?.retentionDays ?? 0;
  const days = Math.min(o.days ?? keep, keep);
  if (days <= 0) return [];
  return getDb()
    .select()
    .from(purchases)
    .where(and(eq(purchases.projectId, projectId), gte(purchases.purchasedAt, new Date(Date.now() - days * 86_400_000))))
    .orderBy(desc(purchases.purchasedAt))
    .limit(Math.min(o.limit ?? 20, 100))
    .all();
}

export function purchaseCount(projectId: string): number {
  return getDb().select({ n: count() }).from(purchases).where(eq(purchases.projectId, projectId)).get()?.n ?? 0;
}

/** Deletes every recorded purchase of the project (the dashboard's "Delete all"); marks on testimonials stay. */
export function deletePurchases(projectId: string): number {
  return getDb().delete(purchases).where(eq(purchases.projectId, projectId)).run().changes;
}

/** "£29.00", in the currency Stripe sent; null without both parts. */
export function formatAmount(amount: number | null, currency: string | null): string | null {
  if (amount === null || !currency) return null;
  try {
    const fmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() });
    const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
    return fmt.format(amount / 10 ** digits);
  } catch {
    return null;
  }
}

/** A purchase as the dashboard lists it: exactly what's stored, minus the hash. */
export function purchaseToAdmin(p: Purchase) {
  return {
    id: p.id,
    eventType: p.eventType,
    firstName: p.firstName,
    place: p.place,
    product: p.product,
    amount: formatAmount(p.amount, p.currency),
    matchable: p.emailHash !== null,
    purchasedAt: p.purchasedAt.toISOString(),
  };
}
export type AdminPurchase = ReturnType<typeof purchaseToAdmin>;

/** Deletes purchases past each connection's retention, and those of projects without a connection. */
export function deleteExpiredPurchases(now = Date.now()) {
  const db = getDb();
  let removed = 0;
  for (const c of db.select({ projectId: stripeConnections.projectId, days: stripeConnections.retentionDays }).from(stripeConnections).all()) {
    removed += db
      .delete(purchases)
      .where(and(eq(purchases.projectId, c.projectId), lt(purchases.purchasedAt, new Date(now - c.days * 86_400_000))))
      .run().changes;
  }
  removed += db.run(sql`DELETE FROM purchases WHERE project_id NOT IN (SELECT project_id FROM stripe_connections)`).changes;
  return removed;
}

export function registerCommerceJobs() {
  registerPeriodic("purchases.retention", 60 * 60 * 1000, () => {
    deleteExpiredPurchases();
  });
}
