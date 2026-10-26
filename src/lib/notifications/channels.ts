import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { CHANNEL_TYPES, type NotificationChannel } from "@/db/schema";
import { originFor } from "../importers/registry";
import { isAllowedOrigin, NetGuardError, postPublicJson } from "../net-guard";
import { formatDiscord, formatSlack, formatTeams, formatTelegram, type NotifyMessage } from "./format";

const { notificationChannels, forms } = schema;

export type ChannelType = (typeof CHANNEL_TYPES)[number];

/** Events a chat channel can post about. */
export const CHANNEL_EVENTS = ["testimonial.created", "testimonial.approved"] as const;
export type ChannelEvent = (typeof CHANNEL_EVENTS)[number];

export const CHANNEL_LABELS: Record<ChannelType, string> = {
  slack: "Slack",
  discord: "Discord",
  teams: "Microsoft Teams",
  telegram: "Telegram",
};

/**
 * Where each service's incoming webhooks live. Only these hosts are posted
 * to (https only), so a channel can't be used to make the server call
 * somewhere else; net-guard still refuses private addresses on every hop.
 * Tests reach a local receiver through NET_GUARD_ALLOW's exact host:port.
 */
const HOSTS: Record<Exclude<ChannelType, "telegram">, { hosts: RegExp[]; path: RegExp; example: string }> = {
  slack: { hosts: [/^hooks\.slack\.com$/], path: /^\/(services|workflows|triggers)\//, example: "https://hooks.slack.com/services/…" },
  discord: {
    hosts: [/^(ptb\.|canary\.)?discord(app)?\.com$/],
    path: /^\/api\/webhooks\/\d+\/[\w-]+/,
    example: "https://discord.com/api/webhooks/…",
  },
  // Teams Workflows (Power Automate) URLs, and the retiring Office 365 connectors.
  teams: {
    hosts: [/^[a-z0-9-]+(\.[a-z0-9-]+)*\.webhook\.office\.com$/, /^[a-z0-9-]+(\.[a-z0-9-]+)*\.logic\.azure\.com$/, /^[a-z0-9-]+(\.[a-z0-9-]+)*\.powerplatform\.com$/],
    path: /^\//,
    example: "https://….logic.azure.com/workflows/…",
  },
};
const TELEGRAM_HOSTS = [/^api\.telegram\.org$/];

const telegramTarget = z.object({
  botToken: z.string().trim().regex(/^\d{3,20}:[A-Za-z0-9_-]{20,80}$/, "That doesn't look like a bot token from @BotFather"),
  chatId: z.string().trim().regex(/^(-?\d{1,20}|@[A-Za-z0-9_]{4,64})$/, "Use the chat's numeric id or its @channelname"),
});
type TelegramTarget = z.infer<typeof telegramTarget>;

function parseTelegram(target: string): TelegramTarget | null {
  try {
    const parsed = telegramTarget.safeParse(JSON.parse(target));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Why a target can't be used (a message for the owner), or null when it's fine. */
export function validateChannelTarget(type: ChannelType, target: string): string | null {
  if (type === "telegram") {
    try {
      const parsed = telegramTarget.safeParse(JSON.parse(target));
      return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Enter the bot token and chat id");
    } catch {
      return "Enter the bot token and chat id";
    }
  }
  const rule = HOSTS[type];
  let url: URL;
  try {
    url = new URL(target.trim());
  } catch {
    return `Paste the webhook URL (${rule.example})`;
  }
  if (url.username || url.password) return "Use the webhook URL without a user name or password";
  // Test receivers only (NET_GUARD_ALLOW); never set in production.
  if (isAllowedOrigin(url) && (url.protocol === "http:" || url.protocol === "https:")) return null;
  if (url.protocol !== "https:") return "Use the https:// webhook URL";
  if (!rule.hosts.some((re) => re.test(url.hostname.toLowerCase())) || !rule.path.test(url.pathname)) {
    return `That isn't a ${CHANNEL_LABELS[type]} webhook URL (${rule.example})`;
  }
  if (url.port && url.port !== "443") return "Use the webhook URL as the service gave it";
  return null;
}

/** For API responses: enough to recognise the target, never enough to post to it. */
export function maskTarget(type: ChannelType, target: string): string {
  if (type === "telegram") {
    const t = parseTelegram(target);
    return t ? `Bot ${t.botToken.split(":")[0]}:… → ${t.chatId}` : "Telegram bot";
  }
  try {
    const url = new URL(target);
    // The first path segment only ("/services/…", "/api/…"): the rest is the secret.
    const first = url.pathname.split("/").filter(Boolean)[0];
    return `${url.origin}/${first ? `${first}/…` : ""}`;
  } catch {
    return "Webhook";
  }
}

function parseList(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function channelEvents(c: Pick<NotificationChannel, "events">): ChannelEvent[] {
  return parseList(c.events).filter((e): e is ChannelEvent => (CHANNEL_EVENTS as readonly string[]).includes(e));
}
export const channelFormIds = (c: Pick<NotificationChannel, "formIds">) => parseList(c.formIds);

/** What the dashboard sees about a channel: the target masked. */
export function channelToAdmin(c: NotificationChannel) {
  return {
    id: c.id,
    projectId: c.projectId,
    type: c.type,
    name: c.name,
    target: maskTarget(c.type, c.target),
    events: channelEvents(c),
    formIds: channelFormIds(c),
    active: c.active,
    lastSentAt: c.lastSentAt ? c.lastSentAt.toISOString() : null,
    lastError: c.lastError,
    createdAt: c.createdAt.toISOString(),
  };
}
export type AdminChannel = ReturnType<typeof channelToAdmin>;

export class ChannelError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const fields = z.object({
  type: z.enum(CHANNEL_TYPES),
  name: z.string().trim().min(1, "Give the channel a name").max(80),
  /** A webhook URL, or for Telegram {botToken, chatId}. */
  target: z.union([z.string().trim().min(1).max(2000), telegramTarget]),
  projectId: z.string().max(64).nullable(),
  events: z.array(z.enum(CHANNEL_EVENTS)).min(1, "Choose at least one event").max(CHANNEL_EVENTS.length),
  formIds: z.array(z.string().max(64)).max(50),
  active: z.boolean(),
});

export const createChannelBody = fields.extend({
  projectId: fields.shape.projectId.default(null),
  events: fields.shape.events.default(["testimonial.created"]),
  formIds: fields.shape.formIds.default([]),
  active: fields.shape.active.default(true),
});
export const channelPatchBody = fields.omit({ type: true }).partial();

function targetString(type: ChannelType, target: string | TelegramTarget): string {
  if (type === "telegram") return JSON.stringify(typeof target === "string" ? (parseTelegram(target) ?? {}) : target);
  if (typeof target !== "string") throw new ChannelError(400, "Paste the webhook URL");
  return target.trim();
}

/** Forms must belong to the channel's project (and an all-projects channel can't pick forms). */
function checkForms(projectId: string | null, formIds: string[]) {
  const unique = [...new Set(formIds)];
  if (!unique.length) return unique;
  if (!projectId) throw new ChannelError(400, "Choose a project before choosing forms");
  for (const id of unique) {
    const f = getDb().select({ projectId: forms.projectId }).from(forms).where(eq(forms.id, id)).get();
    if (!f || f.projectId !== projectId) throw new ChannelError(400, "Choose forms from this channel's project");
  }
  return unique;
}

export function listChannels(o: { projectId?: string } = {}): NotificationChannel[] {
  const rows = getDb().select().from(notificationChannels).orderBy(desc(notificationChannels.createdAt)).all();
  return o.projectId ? rows.filter((c) => c.projectId === null || c.projectId === o.projectId) : rows;
}

export function getChannel(id: string): NotificationChannel | null {
  return getDb().select().from(notificationChannels).where(eq(notificationChannels.id, id)).get() ?? null;
}

export function createChannel(input: z.infer<typeof createChannelBody>): NotificationChannel {
  const target = targetString(input.type, input.target);
  const problem = validateChannelTarget(input.type, target);
  if (problem) throw new ChannelError(400, problem);
  const formIds = checkForms(input.projectId, input.formIds);
  return getDb()
    .insert(notificationChannels)
    .values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      type: input.type,
      name: input.name,
      target,
      events: JSON.stringify([...new Set(input.events)]),
      formIds: JSON.stringify(formIds),
      active: input.active,
      createdAt: new Date(),
    })
    .returning()
    .get();
}

export function updateChannel(id: string, patch: z.infer<typeof channelPatchBody>): NotificationChannel | null {
  const c = getChannel(id);
  if (!c) return null;
  const set: Partial<typeof notificationChannels.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.events !== undefined) set.events = JSON.stringify([...new Set(patch.events)]);
  if (patch.target !== undefined) {
    const target = targetString(c.type, patch.target);
    const problem = validateChannelTarget(c.type, target);
    if (problem) throw new ChannelError(400, problem);
    set.target = target;
    set.lastError = null;
  }
  const projectId = patch.projectId !== undefined ? patch.projectId : c.projectId;
  if (patch.projectId !== undefined) set.projectId = patch.projectId;
  // Moving to another project lets go of the old project's forms.
  const formIds = patch.formIds ?? (patch.projectId !== undefined && patch.projectId !== c.projectId ? [] : channelFormIds(c));
  set.formIds = JSON.stringify(checkForms(projectId, formIds));
  return getDb().update(notificationChannels).set(set).where(eq(notificationChannels.id, id)).returning().get() ?? null;
}

export function deleteChannel(id: string): boolean {
  return getDb().delete(notificationChannels).where(eq(notificationChannels.id, id)).run().changes > 0;
}

/** A send that failed in a way retrying won't fix (the hook was deleted, the token is wrong). */
export class ChannelGoneError extends NetGuardError {}

/**
 * Posts one message to a channel through net-guard: https to the service's
 * own hosts only, private addresses refused, 10 s timeout, small answer cap.
 * Throws with a readable message when the service doesn't accept it.
 */
export async function sendToChannel(c: Pick<NotificationChannel, "type" | "target">, m: NotifyMessage): Promise<void> {
  const problem = validateChannelTarget(c.type, c.target);
  if (problem) throw new ChannelGoneError(problem);
  let url: string;
  let body: object;
  let allowHosts: RegExp[];
  if (c.type === "telegram") {
    const t = parseTelegram(c.target)!;
    // IMPORTER_ORIGINS lets tests point this at a local stand-in; otherwise the real API.
    url = `${originFor("telegram", "https://api.telegram.org")}/bot${t.botToken}/sendMessage`;
    body = { chat_id: t.chatId, ...formatTelegram(m) };
    allowHosts = TELEGRAM_HOSTS;
  } else {
    url = c.target;
    body = c.type === "slack" ? formatSlack(m) : c.type === "discord" ? formatDiscord(m) : formatTeams(m);
    allowHosts = HOSTS[c.type].hosts;
  }
  const res = await postPublicJson(url, body, { timeoutMs: 10_000, allowHosts });
  if (res.status >= 200 && res.status < 300) return;
  const detail = res.text.replace(/\s+/g, " ").trim().slice(0, 140);
  const message = `${CHANNEL_LABELS[c.type]} answered ${res.status}${detail ? `: ${detail}` : ""}`;
  // 4xx (other than rate limits) means the hook or token is wrong: don't retry.
  if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new ChannelGoneError(message);
  throw new Error(message);
}

/** Records the outcome on the channel, for the dashboard. */
export function noteResult(id: string, error: string | null) {
  getDb()
    .update(notificationChannels)
    .set(error ? { lastError: error.slice(0, 300) } : { lastSentAt: new Date(), lastError: null })
    .where(eq(notificationChannels.id, id))
    .run();
}
