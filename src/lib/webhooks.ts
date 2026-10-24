import crypto from "node:crypto";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Project, Webhook, WebhookEvent } from "@/db/schema";
import { projectToApi, toApi } from "./api-shape";
import { enqueue } from "./jobs";
import type { TestimonialWithTags } from "./testimonials";

const { webhooks, webhookDeliveries, projects } = schema;

/**
 * Signed webhooks for automation tools (n8n, Zapier, Make, Activepieces).
 * Each event becomes a delivery row plus a job; failed deliveries are retried
 * with backoff (about 30 s, 2 min, 8 min, 32 min and 2 h; 6 attempts) and every attempt is
 * visible in the dashboard.
 *
 * Signature: `Plaudit-Signature: t=<unix seconds>,v1=<hex>` where v1 is
 * HMAC-SHA256(secret, `${t}.${rawBody}`). See docs/API.md for verifying it.
 */
export const DELIVER_JOB = "webhook.deliver";
const MAX_ATTEMPTS = 6;
const TIMEOUT_MS = 10_000;

export function newSecret() {
  return `whsec_${crypto.randomBytes(24).toString("base64url")}`;
}

export function sign(secret: string, timestamp: number, body: string) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function signatureHeader(secret: string, body: string, now = Date.now()) {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${sign(secret, t, body)}`;
}

/** Reference verifier (also used by the tests): checks the HMAC and the age. */
export function verifySignature(secret: string, header: string, body: string, toleranceSec = 300, now = Date.now()) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceSec || !parts.v1) return false;
  const expected = Buffer.from(sign(secret, t, body));
  const given = Buffer.from(parts.v1);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function parseEvents(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((e) => typeof e === "string") : [];
  } catch {
    return [];
  }
}

function subscribers(event: WebhookEvent, projectId: string | null) {
  const rows = getDb()
    .select()
    .from(webhooks)
    .where(
      and(
        eq(webhooks.active, true),
        projectId ? or(isNull(webhooks.projectId), eq(webhooks.projectId, projectId)) : isNull(webhooks.projectId),
      ),
    )
    .all();
  return rows.filter((w) => {
    const events = parseEvents(w.events);
    return events.length === 0 || events.includes(event);
  });
}

function queueDelivery(hook: Webhook, event: WebhookEvent, body: object) {
  const id = crypto.randomUUID();
  const payload = JSON.stringify({ id, event, createdAt: new Date().toISOString(), ...body });
  getDb()
    .insert(webhookDeliveries)
    .values({ id, webhookId: hook.id, event, payload, createdAt: new Date() })
    .run();
  enqueue(DELIVER_JOB, { deliveryId: id }, { maxAttempts: MAX_ATTEMPTS });
  return id;
}

/** Fans an event out to every matching webhook. Never throws into the caller. */
export function emitTestimonialEvent(event: WebhookEvent, t: TestimonialWithTags | null | undefined) {
  if (!t) return 0;
  try {
    const hooks = subscribers(event, t.projectId);
    if (!hooks.length) return 0;
    const project = getDb().select().from(projects).where(eq(projects.id, t.projectId)).get();
    const data = { testimonial: toApi(t), ...(event === "testimonial.approved" ? { approvedBy: t.approvedBy } : {}) };
    const body = { project: project ? projectToApi(project) : null, data };
    for (const hook of hooks) queueDelivery(hook, event, body);
    return hooks.length;
  } catch (err) {
    console.error(`[webhooks] could not queue ${event}:`, err);
    return 0;
  }
}

/** Sends a "ping" so the owner can check their endpoint. */
export function sendTestEvent(hook: Webhook, project?: Project | null) {
  return queueDelivery(hook, "ping", {
    project: project ? projectToApi(project) : null,
    data: { message: "This is a test event from Plaudit." },
  });
}

export async function deliver(deliveryId: string, final: boolean) {
  const db = getDb();
  const d = db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryId)).get();
  if (!d) return;
  const hook = db.select().from(webhooks).where(eq(webhooks.id, d.webhookId)).get();
  if (!hook) return;
  if (!hook.active) {
    // Paused after this was queued: record it and stop retrying.
    db.update(webhookDeliveries)
      .set({ status: "failed", error: "Not sent: the webhook is paused" })
      .where(eq(webhookDeliveries.id, d.id))
      .run();
    return;
  }
  const started = Date.now();
  let status: number | null = null;
  let text = "";
  let error: string | null = null;
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Plaudit-Webhooks/1",
        "Plaudit-Event": d.event,
        "Plaudit-Delivery": d.id,
        "Plaudit-Signature": signatureHeader(hook.secret, d.payload),
      },
      body: d.payload,
      // A redirect could send the signed payload somewhere unexpected.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    text = (await res.text().catch(() => "")).slice(0, 1000);
    if (!res.ok) error = res.status >= 300 && res.status < 400 ? `Redirects aren't followed (${res.status})` : `HTTP ${res.status}`;
  } catch (err) {
    error = (err as Error).name === "TimeoutError" ? `No response within ${TIMEOUT_MS / 1000} s` : (err as Error).message;
  }
  const ok = error === null;
  db.update(webhookDeliveries)
    .set({
      attempts: d.attempts + 1,
      status: ok ? "success" : final ? "failed" : "pending",
      responseStatus: status,
      responseBody: text || null,
      error,
      durationMs: Date.now() - started,
      deliveredAt: ok ? new Date() : null,
    })
    .where(eq(webhookDeliveries.id, d.id))
    .run();
  if (!ok) throw new Error(error!);
}

/** Queues another attempt for a delivery, keeping its history. */
export function redeliver(deliveryId: string) {
  const d = getDb().select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryId)).get();
  if (!d) return null;
  getDb().update(webhookDeliveries).set({ status: "pending" }).where(eq(webhookDeliveries.id, d.id)).run();
  enqueue(DELIVER_JOB, { deliveryId }, { maxAttempts: MAX_ATTEMPTS });
  return d;
}

export function listDeliveries(webhookId: string, limit = 25) {
  return getDb()
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit)
    .all();
}
