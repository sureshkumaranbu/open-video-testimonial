import dns from "node:dns/promises";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { WEBHOOK_EVENTS } from "@/db/schema";
import { apiJson } from "@/lib/api-keys";
import { apiError, hookToApi, MAX_SMALL_BYTES, projectForKey, readJson, requireApi2 } from "@/lib/api-v1";
import { audit, keyActor } from "@/lib/audit";
import { isAllowedOrigin, isPrivateAddress } from "@/lib/net-guard";
import { firstIssue } from "@/lib/validation";
import { createWebhook } from "@/lib/webhook-admin";

/** Subscriptions one key may hold (Zapier makes one per Zap step). */
const MAX_PER_KEY = 50;

const body = z.object({
  url: z.url({ protocol: /^https?$/, error: "Use an http:// or https:// URL" }).max(2000),
  /** The events to send; at least one (an API subscription never gets the catch-all default set). */
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Choose at least one event").max(WEBHOOK_EVENTS.length),
  /** A project's slug; required for a key limited to some projects. */
  project: z.string().trim().max(120).optional(),
});

/** API subscriptions go to public addresses only (a leaked key mustn't reach your private network); delivery checks again. */
async function publicTarget(raw: string) {
  const url = new URL(raw);
  if (isAllowedOrigin(url)) return true;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  try {
    const addrs = await dns.lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

/** GET /api/v1/webhooks (read): the subscriptions this key made. */
export async function GET(req: Request) {
  const auth = requireApi2(req, "read");
  if (auth.error) return auth.error;
  const rows = getDb().select().from(schema.webhooks).where(eq(schema.webhooks.apiKeyId, auth.key.id)).all();
  return apiJson({ data: rows.map((h) => hookToApi(h)) });
}

/**
 * POST /api/v1/webhooks (write): subscribes a URL to events, as REST hooks
 * (Zapier's instant triggers) need. The hook is signed like any other, shows
 * in Settings › Webhooks (marked as added by this key) and can be deleted there.
 */
export async function POST(req: Request) {
  const auth = requireApi2(req, "write");
  if (auth.error) return auth.error;
  const raw = await readJson(req, MAX_SMALL_BYTES);
  if (raw.error) return raw.error;
  const parsed = body.safeParse(raw.value);
  if (!parsed.success) return apiError(400, firstIssue(parsed.error));
  const { url, events, project: slug } = parsed.data;
  let projectId: string | null = null;
  if (slug) {
    const p = projectForKey(auth.key, slug);
    if (!p) return apiError(404, "Project not found");
    projectId = p.id;
  } else if (!auth.key.allProjects) {
    return apiError(400, "This key reaches only some projects: say which one (project)");
  }
  const count = getDb().select({ id: schema.webhooks.id }).from(schema.webhooks).where(and(eq(schema.webhooks.apiKeyId, auth.key.id))).all().length;
  if (count >= MAX_PER_KEY) return apiError(409, `A key can hold up to ${MAX_PER_KEY} subscriptions; delete some first`);
  if (!(await publicTarget(url))) return apiError(400, "Subscriptions must point at a public address");
  const hook = createWebhook({ url, events, projectId, formId: null, active: true });
  getDb().update(schema.webhooks).set({ apiKeyId: auth.key.id }).where(eq(schema.webhooks.id, hook.id)).run();
  audit(keyActor(auth.key), "webhook.create", { objectType: "webhook", objectId: hook.id, projectId, summary: new URL(url).host, meta: { events, via: "api" } });
  return apiJson({ data: hookToApi({ ...hook, apiKeyId: auth.key.id }, { secret: true }) }, 201);
}
