import { z } from "zod";
import { CampaignError, createInvite, findCampaignByWebhookToken, inviteInput } from "@/lib/campaigns";
import { jsonError } from "@/lib/http";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

/** Largest body accepted: an invite is a handful of short fields. */
const MAX_BYTES = 16 * 1024;
const HEADERS = { "Cache-Control": "no-store" };

const KNOWN = new Set(["email", "name", "company", "title", "delayDays", "variables"]);

/** `{ email, name, company, title?, delayDays?, ...anything else }`: the rest become template variables. */
const body = z
  .record(z.string().max(40), z.unknown())
  .refine((o) => Object.keys(o).length <= 40, "Send at most 40 fields")
  .transform((o, ctx) => {
    const extra = Object.fromEntries(Object.entries(o).filter(([k]) => !KNOWN.has(k)));
    const nested = o.variables && typeof o.variables === "object" && !Array.isArray(o.variables) ? (o.variables as Record<string, unknown>) : {};
    const parsed = inviteInput.safeParse({
      email: o.email,
      name: o.name ?? undefined,
      company: o.company ?? undefined,
      title: o.title ?? undefined,
      delayDays: o.delayDays ?? undefined,
      variables: Object.fromEntries(
        Object.entries({ ...extra, ...nested }).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v)),
      ),
    });
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: firstIssue(parsed.error) });
      return z.NEVER;
    }
    return parsed.data;
  });

/**
 * A campaign's incoming webhook (REQ-07): POST JSON from your shop, CRM or an
 * automation tool, and the person gets the campaign's invitation, optionally
 * `delayDays` (or `?delay=`) days later. The URL's token is random and only
 * its hash is stored; regenerating the URL in the dashboard retires the old one.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  // Slows anyone trying tokens, and keeps one sender from flooding a campaign.
  if (!rateLimit(`campaign-hook-ip:${clientKey(req)}`, 120, 60 * 1000)) {
    return jsonError(429, "Too many requests: wait a minute, then try again", { ...HEADERS, "Retry-After": "60" });
  }
  const campaign = findCampaignByWebhookToken((await ctx.params).token);
  const project = campaign && getProjectById(campaign.projectId);
  if (!campaign || !project) return jsonError(404, "Unknown webhook URL", HEADERS);
  if (!rateLimit(`campaign-hook:${campaign.id}`, 120, 60 * 1000)) {
    return jsonError(429, "This campaign's webhook takes at most 120 invites a minute", { ...HEADERS, "Retry-After": "60" });
  }
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) return jsonError(415, "Send JSON (Content-Type: application/json)", HEADERS);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return jsonError(413, "The body is too large (16 KB at most)", HEADERS);
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BYTES) return jsonError(413, "The body is too large (16 KB at most)", HEADERS);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return jsonError(400, "The body isn't valid JSON", HEADERS);
  }
  const delay = new URL(req.url).searchParams.get("delay");
  if (delay !== null && json && typeof json === "object" && !Array.isArray(json) && !("delayDays" in json)) {
    (json as Record<string, unknown>).delayDays = /^\d+(\.\d+)?$/.test(delay) ? Number(delay) : delay;
  }
  const parsed = body.safeParse(json);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error), HEADERS);
  try {
    const { invite, skipped } = createInvite(project, campaign, parsed.data);
    return Response.json(
      { ok: true, inviteId: invite?.id ?? null, ...(skipped ? { skipped } : {}), scheduledFor: invite?.scheduledFor?.toISOString() ?? null },
      { status: skipped ? 200 : 202, headers: HEADERS },
    );
  } catch (err) {
    if (err instanceof CampaignError) return jsonError(err.status, err.message, HEADERS);
    throw err;
  }
}
