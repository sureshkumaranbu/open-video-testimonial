import crypto from "node:crypto";
import type { TriggerProvider } from "@/db/schema";
import { CampaignError, createInvite, getCampaign } from "./campaigns";
import { firstDelivery, forgetDelivery, getTrigger, noteResult, personFromShopify, personFromStripe, triggerEventsOf, verifyShopify, verifyStripe } from "./campaign-triggers";
import { featureOn } from "./features";
import { jsonError } from "./http";
import { clientKey, rateLimit } from "./rate-limit";
import { getProjectById } from "./testimonials";

/** Stripe events and Shopify orders are a few KB; well under this. */
const MAX_BYTES = 256 * 1024;
const DAILY_LIMIT = 2000;
const HEADERS = { "Cache-Control": "no-store" };

async function readCapped(req: Request, max: number) {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const ok = (body: Record<string, unknown>) => Response.json({ ok: true, ...body }, { headers: HEADERS });

/**
 * POST /api/hooks/{stripe|shopify}/<trigger id> (REQ-07). Checks the
 * signature over the raw body before anything else is read, handles each
 * delivery once, and answers 200 for events it doesn't act on, so the
 * provider doesn't retry them. A paused campaign answers 409 (and the
 * delivery is forgotten), so the provider's retry can work once it's resumed.
 */
export async function triggerHook(req: Request, provider: TriggerProvider, id: string): Promise<Response> {
  if (!featureOn("campaigns")) return jsonError(404, "Not found", HEADERS);
  if (!rateLimit(`trigger-hook-ip:${clientKey(req)}`, 120, 60 * 1000)) return jsonError(429, "Too many requests", { ...HEADERS, "Retry-After": "60" });
  const t = getTrigger(id);
  if (!t || t.provider !== provider) return jsonError(404, "Unknown trigger", HEADERS);
  if (!rateLimit(`trigger-hook:${t.id}`, 120, 60 * 1000) || !rateLimit(`trigger-hook-day:${t.id}`, DAILY_LIMIT, 24 * 60 * 60 * 1000)) {
    return jsonError(429, "This trigger is taking too many deliveries", { ...HEADERS, "Retry-After": "3600" });
  }
  if (!t.secret) return jsonError(409, "Add the signing secret to this trigger in Plaudit first", HEADERS);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return jsonError(413, "The body is too large", HEADERS);
  const raw = await readCapped(req, MAX_BYTES);
  if (raw === null) return jsonError(413, "The body is too large", HEADERS);

  const signed =
    provider === "stripe"
      ? verifyStripe(t.secret, req.headers.get("stripe-signature") ?? "", raw)
      : verifyShopify(t.secret, req.headers.get("x-shopify-hmac-sha256") ?? "", raw);
  if (!signed) {
    noteResult(t.id, "Refused a delivery with a wrong signature (check the signing secret)");
    return jsonError(400, "The signature doesn't match", HEADERS);
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError(400, "The body isn't valid JSON", HEADERS);
  }
  if (!t.enabled) return ok({ ignored: "trigger off" });

  const event = provider === "stripe" ? String(body.type ?? "") : (req.headers.get("x-shopify-topic") ?? "");
  if (!triggerEventsOf(t.events).includes(event)) return ok({ ignored: `not acting on ${event || "this event"}` });
  const externalId =
    (provider === "stripe" ? (typeof body.id === "string" ? body.id : null) : (req.headers.get("x-shopify-webhook-id") ?? req.headers.get("x-shopify-event-id"))) ??
    crypto.createHash("sha256").update(raw).digest("hex");
  if (!firstDelivery(t.id, externalId)) return ok({ duplicate: true });

  const person = provider === "stripe" ? personFromStripe(body as Parameters<typeof personFromStripe>[0]) : personFromShopify(body);
  if ("skip" in person) {
    noteResult(t.id, `Skipped ${event}: ${person.skip}`);
    return ok({ ignored: person.skip });
  }
  const campaign = getCampaign(t.campaignId);
  const project = campaign && getProjectById(campaign.projectId);
  if (!campaign || !project) return jsonError(404, "Unknown trigger", HEADERS);
  try {
    const { invite, skipped } = createInvite(project, campaign, { email: person.email, name: person.name, company: person.company, delayDays: t.delayDays });
    noteResult(t.id, skipped ? `Skipped ${person.email}: ${skipped}` : `Invited ${person.email}${t.delayDays ? ` (${t.delayDays} days later)` : ""}`);
    return ok({ inviteId: invite?.id ?? null, ...(skipped ? { skipped } : {}), scheduledFor: invite?.scheduledFor?.toISOString() ?? null });
  } catch (err) {
    if (err instanceof CampaignError) {
      forgetDelivery(t.id, externalId);
      noteResult(t.id, `Couldn't invite ${person.email}: ${err.message}`);
      return jsonError(err.status, err.message, HEADERS);
    }
    throw err;
  }
}
