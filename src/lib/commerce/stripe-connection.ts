import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { StripeConnection } from "@/db/schema";
import { env } from "../env";

const { stripeConnections } = schema;

/**
 * INT-07 (M18): one Stripe connection per project, for the sales popup,
 * "Verified purchase" and thank-you coupons. Separate from a campaign's
 * Stripe trigger (REQ-07): a trigger invites buyers to a campaign, this one
 * records purchases for the project. Its signing secret and restricted key
 * are stored as entered (both are needed in full) and never sent back.
 */

export const MAX_RETENTION_DAYS = 365;
export const DEFAULT_RETENTION_DAYS = 90;

const secret = z.string().trim().max(500);
export const connectionBody = z
  .object({
    /** The webhook endpoint's signing secret (whsec_…); "" clears it. */
    signingSecret: secret.refine((v) => v === "" || v.length >= 8, "Paste the signing secret from Stripe (it starts whsec_)"),
    /** A restricted key (rk_…); "" clears it and thank-you coupons stop. */
    restrictedKey: secret.refine((v) => v === "" || /^rk_(live|test)_[A-Za-z0-9]{8,}$/.test(v), "Use a restricted key (rk_live_… or rk_test_…), not a secret key"),
    enabled: z.boolean(),
    retentionDays: z.number().int("Whole days").min(1, "Keep purchases for at least a day").max(MAX_RETENTION_DAYS, `Keep purchases for at most ${MAX_RETENTION_DAYS} days`),
    verifyPurchases: z.boolean(),
    defaultProduct: z.string().trim().max(80),
  })
  .partial();
export type ConnectionPatch = z.infer<typeof connectionBody>;

export function getConnection(projectId: string): StripeConnection | null {
  return getDb().select().from(stripeConnections).where(eq(stripeConnections.projectId, projectId)).get() ?? null;
}

export function getConnectionById(id: string): StripeConnection | null {
  return getDb().select().from(stripeConnections).where(eq(stripeConnections.id, id)).get() ?? null;
}

/** The project's connection, made (empty) the first time it's saved. */
export function saveConnection(projectId: string, patch: ConnectionPatch): StripeConnection {
  const db = getDb();
  const now = new Date();
  const existing = getConnection(projectId);
  const set = {
    ...(patch.signingSecret !== undefined ? { signingSecret: patch.signingSecret } : {}),
    ...(patch.restrictedKey !== undefined ? { restrictedKey: patch.restrictedKey } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.retentionDays !== undefined ? { retentionDays: patch.retentionDays } : {}),
    ...(patch.verifyPurchases !== undefined ? { verifyPurchases: patch.verifyPurchases } : {}),
    ...(patch.defaultProduct !== undefined ? { defaultProduct: patch.defaultProduct } : {}),
  };
  if (existing) {
    return db.update(stripeConnections).set({ ...set, updatedAt: now }).where(eq(stripeConnections.id, existing.id)).returning().get();
  }
  return db
    .insert(stripeConnections)
    .values({ id: crypto.randomUUID(), projectId, ...set, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

/** Removes the connection; its purchases go too (the caller deletes them). */
export function deleteConnection(projectId: string) {
  return getDb().delete(stripeConnections).where(eq(stripeConnections.projectId, projectId)).returning().get() ?? null;
}

export function noteConnectionResult(id: string, result: string, now = new Date()) {
  getDb().update(stripeConnections).set({ lastEventAt: now, lastResult: result.slice(0, 300) }).where(eq(stripeConnections.id, id)).run();
}

export const connectionUrl = (c: Pick<StripeConnection, "id">) => `${env.publicUrl}/api/hooks/stripe-purchases/${c.id}`;

/** The connection as Settings shows it: whether each secret is set, never the secrets. */
export function connectionToAdmin(c: StripeConnection | null) {
  if (!c) return null;
  return {
    id: c.id,
    url: connectionUrl(c),
    signingSecretSet: c.signingSecret.length > 0,
    restrictedKeySet: c.restrictedKey.length > 0,
    /** The key's last four characters, so the owner can tell which one it is. */
    restrictedKeyHint: c.restrictedKey ? `…${c.restrictedKey.slice(-4)}` : null,
    enabled: c.enabled,
    retentionDays: c.retentionDays,
    verifyPurchases: c.verifyPurchases,
    defaultProduct: c.defaultProduct,
    lastEventAt: c.lastEventAt?.toISOString() ?? null,
    lastResult: c.lastResult,
    createdAt: c.createdAt.toISOString(),
  };
}
export type AdminStripeConnection = NonNullable<ReturnType<typeof connectionToAdmin>>;
