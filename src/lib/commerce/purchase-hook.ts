import { audit, SYSTEM } from "../audit";
import { verifyStripe } from "../campaign-triggers";
import { featureOn } from "../features";
import { jsonError, readCappedText } from "../http";
import { clientKey, rateLimit } from "../rate-limit";
import { purchaseFromStripe, recordPurchase } from "./purchases";
import { getConnectionById, noteConnectionResult } from "./stripe-connection";

/** A Stripe event is a few KB; well under this. */
const MAX_BYTES = 256 * 1024;
const DAILY_LIMIT = 5000;
const HEADERS = { "Cache-Control": "no-store" };
const ok = (body: Record<string, unknown>) => Response.json({ ok: true, ...body }, { headers: HEADERS });

/**
 * POST /api/hooks/stripe-purchases/<connection id> (INT-07). The same rules
 * as a campaign's Stripe trigger: the signature over the raw body is checked
 * before anything else is read (the URL isn't secret), each event is recorded
 * once, and events it doesn't act on get a 200 so Stripe doesn't retry them.
 */
export async function purchaseHook(req: Request, id: string): Promise<Response> {
  if (!featureOn("commerce")) return jsonError(404, "Not found", HEADERS);
  if (!rateLimit(`purchase-hook-ip:${clientKey(req)}`, 120, 60 * 1000)) return jsonError(429, "Too many requests", { ...HEADERS, "Retry-After": "60" });
  const c = getConnectionById(id);
  if (!c) return jsonError(404, "Unknown connection", HEADERS);
  if (!rateLimit(`purchase-hook:${c.id}`, 300, 60 * 1000) || !rateLimit(`purchase-hook-day:${c.id}`, DAILY_LIMIT, 24 * 60 * 60 * 1000)) {
    return jsonError(429, "This connection is taking too many deliveries", { ...HEADERS, "Retry-After": "3600" });
  }
  if (!c.signingSecret) return jsonError(409, "Add the signing secret to this project's Stripe connection in Plaudit first", HEADERS);
  const raw = await readCappedText(req, MAX_BYTES);
  if (raw === null) return jsonError(413, "The body is too large", HEADERS);
  if (!verifyStripe(c.signingSecret, req.headers.get("stripe-signature") ?? "", raw)) {
    noteConnectionResult(c.id, "Refused a delivery with a wrong signature (check the signing secret)");
    return jsonError(400, "The signature doesn't match", HEADERS);
  }
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return jsonError(400, "The body isn't valid JSON", HEADERS);
  }
  if (!c.enabled) return ok({ ignored: "connection off" });
  const facts = purchaseFromStripe(event);
  if ("skip" in facts) return ok({ ignored: facts.skip });
  const saved = recordPurchase(c, facts);
  if (!saved) return ok({ duplicate: true });
  const who = [facts.firstName, facts.place].filter(Boolean).join(" from ") || "someone";
  noteConnectionResult(c.id, `Recorded a purchase by ${who}${saved.marked ? ` (marked ${saved.marked} testimonial${saved.marked === 1 ? "" : "s"} as a verified purchase)` : ""}`);
  if (saved.marked) {
    audit(SYSTEM, "purchase.verify", { objectType: "purchase", objectId: saved.purchase.id, projectId: c.projectId, summary: `Marked ${saved.marked} testimonial${saved.marked === 1 ? "" : "s"} as a verified purchase` });
  }
  return ok({ purchaseId: saved.purchase.id, ...(saved.marked ? { marked: saved.marked } : {}) });
}
