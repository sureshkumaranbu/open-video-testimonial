import crypto from "node:crypto";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Project, Webhook, WebhookEvent } from "@/db/schema";
import { projectToApi, toApi } from "./api-shape";
import { enqueue } from "./jobs";
import { fetchPublicText } from "./net-guard";
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

/**
 * What a webhook with no events selected receives: the original six, plus
 * hidden, trashed and restored, so a catch-all hook still hears about every
 * takedown (D7). The busier events (testimonial.updated, form.submitted,
 * feedback.created, import.completed) go only to hooks that select them.
 */
export const DEFAULT_EVENTS: readonly WebhookEvent[] = [
  "testimonial.created",
  "testimonial.approved",
  "testimonial.rejected",
  "testimonial.deleted",
  "testimonial.transcribed",
  "consent.withdrawn",
  "testimonial.hidden",
  "testimonial.trashed",
  "testimonial.restored",
];

/**
 * Active hooks for an event: every-project hooks and the project's own, then
 * by their events (none selected = DEFAULT_EVENTS). A hook set on one form
 * (FORM-10) hears only about that form's testimonials.
 */
export function subscribers(event: WebhookEvent, projectId: string | null, formId?: string | null) {
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
    const wanted = events.length ? events.includes(event) : DEFAULT_EVENTS.includes(event);
    return wanted && (!w.formId || w.formId === formId);
  });
}

/** What listeners (notifications, WP7.1) get with each event. */
export type EventContext = {
  project: Project;
  testimonial?: TestimonialWithTags;
  formId: string | null;
  /** Set for bulk work (imports) that sends no webhooks; a listener decides what that means for it. */
  quiet: boolean;
};
export type EventListener = (event: WebhookEvent, ctx: EventContext) => void;

const listeners: EventListener[] = [];

/** Lets another area react to every event (as notifications do) without this file changing again. */
export function registerEventListener(fn: EventListener) {
  if (!listeners.includes(fn)) listeners.push(fn);
}

/** The project and payload are only built when a hook or listener will use them. */
function fanOut(
  event: WebhookEvent,
  projectId: string | null,
  loadProject: () => Project | null,
  data: () => object,
  o: { formId?: string | null; quiet?: boolean; testimonial?: TestimonialWithTags },
) {
  let sent = 0;
  let project: Project | null = null;
  try {
    const hooks = o.quiet ? [] : subscribers(event, projectId, o.formId);
    if (!hooks.length && !listeners.length) return 0;
    project = loadProject();
    if (hooks.length) {
      const body = { project: project ? projectToApi(project) : null, data: data() };
      for (const hook of hooks) queueDelivery(hook, event, body);
      sent = hooks.length;
    }
  } catch (err) {
    console.error(`[webhooks] could not queue ${event}:`, err);
  }
  if (project) {
    for (const fn of listeners) {
      try {
        fn(event, { project, testimonial: o.testimonial, formId: o.formId ?? null, quiet: Boolean(o.quiet) });
      } catch (err) {
        console.error(`[webhooks] a listener failed on ${event}:`, err);
      }
    }
  }
  return sent;
}

/**
 * Sends an event to every matching webhook and listener; `quiet` skips the
 * webhooks. Returns how many deliveries were queued. Never throws into the caller.
 */
export function emitEvent(
  event: WebhookEvent,
  project: Project | null,
  data: object,
  o: { formId?: string | null; quiet?: boolean } = {},
) {
  return fanOut(event, project?.id ?? null, () => project, () => data, o);
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

/** Fans a testimonial's event out to every matching webhook (and listener). Never throws into the caller. */
export function emitTestimonialEvent(event: WebhookEvent, t: TestimonialWithTags | null | undefined) {
  if (!t) return 0;
  const project = () => getDb().select().from(projects).where(eq(projects.id, t.projectId)).get() ?? null;
  const data = () => ({ testimonial: toApi(t), ...(event === "testimonial.approved" ? { approvedBy: t.approvedBy } : {}) });
  return fanOut(event, t.projectId, project, data, { formId: t.formId, testimonial: t });
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
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "Plaudit-Webhooks/1",
    "Plaudit-Event": d.event,
    "Plaudit-Delivery": d.id,
    "Plaudit-Signature": signatureHeader(hook.secret, d.payload),
  };
  try {
    if (hook.apiKeyId) {
      // M14: a hook an API key subscribed (Zapier) may only reach public addresses, checked at connect time.
      const res = await fetchPublicText(hook.url, { method: "POST", headers, body: d.payload, maxRedirects: 0, maxBytes: 64 * 1024, timeoutMs: TIMEOUT_MS });
      status = res.status;
      text = res.text.slice(0, 1000);
      if (status < 200 || status >= 300) error = status >= 300 && status < 400 ? `Redirects aren't followed (${status})` : `HTTP ${status}`;
    } else {
      const res = await fetch(hook.url, {
        method: "POST",
        headers,
        body: d.payload,
        // A redirect could send the signed payload somewhere unexpected.
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
      text = (await res.text().catch(() => "")).slice(0, 1000);
      if (!res.ok) error = res.status >= 300 && res.status < 400 ? `Redirects aren't followed (${res.status})` : `HTTP ${res.status}`;
    }
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
