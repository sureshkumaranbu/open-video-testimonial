import { env } from "../env";
import { ProviderError, providerRequest } from "../provider-fetch";

/**
 * The one Stripe API call Plaudit makes (INT-07): creating a single-use
 * promotion code from a coupon the owner picked, with the project's
 * restricted key. That key needs only "Promotion codes: write". The base
 * address is STRIPE_API_URL (https://api.stripe.com; e2e points it at the
 * fixture server). The API version is pinned, so an account's own default
 * version can't change the request's shape.
 */

export const STRIPE_API_VERSION = "2024-06-20";
const TIMEOUT_MS = 10_000;

export class StripeApiError extends Error {}

/** Stripe's own message for a failed request, without echoing anything secret. */
function stripeMessage(err: unknown): string {
  if (err instanceof ProviderError) {
    const e = (err.body as { error?: { message?: unknown; code?: unknown } } | undefined)?.error;
    if (e && typeof e.message === "string") return `Stripe said: ${e.message.slice(0, 200)}${typeof e.code === "string" ? ` (${e.code})` : ""}`;
    if (err.status === 401) return "Stripe refused the restricted key (401)";
    if (err.status === 403) return "The restricted key isn't allowed to write promotion codes (403)";
    return err.message.replace(/rk_(live|test)_[A-Za-z0-9]+/g, "rk_…");
  }
  return "Couldn't reach Stripe";
}

export type PromotionCode = { id: string; code: string };

/**
 * A new promotion code for `coupon`, usable once. `idempotencyKey` makes a
 * retry return the same code instead of making another.
 */
export async function createPromotionCode(o: {
  restrictedKey: string;
  coupon: string;
  idempotencyKey: string;
  expiresAt?: Date | null;
  metadata?: Record<string, string>;
}): Promise<PromotionCode> {
  const body = new URLSearchParams({ coupon: o.coupon, max_redemptions: "1" });
  if (o.expiresAt) body.set("expires_at", String(Math.floor(o.expiresAt.getTime() / 1000)));
  for (const [k, v] of Object.entries(o.metadata ?? {})) body.set(`metadata[${k}]`, v.slice(0, 500));
  let json: unknown;
  try {
    json = await providerRequest(`${env.stripeApiUrl}/v1/promotion_codes`, {
      method: "POST",
      body: body.toString(),
      contentType: "application/x-www-form-urlencoded",
      headers: { Authorization: `Bearer ${o.restrictedKey}`, "Stripe-Version": STRIPE_API_VERSION, "Idempotency-Key": o.idempotencyKey.slice(0, 255) },
      timeoutMs: TIMEOUT_MS,
      maxBytes: 256 * 1024,
    });
  } catch (err) {
    throw new StripeApiError(stripeMessage(err));
  }
  const p = json as { id?: unknown; code?: unknown };
  if (typeof p.id !== "string" || typeof p.code !== "string" || !p.code) throw new StripeApiError("Stripe's answer had no promotion code");
  return { id: p.id, code: p.code.slice(0, 100) };
}
