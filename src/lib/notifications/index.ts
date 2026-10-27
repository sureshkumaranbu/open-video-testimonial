import { and, desc, eq, gte, inArray, isNull, lt, ne, notLike, or, sql } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/db";
import type { Project, WebhookEvent } from "@/db/schema";
import { env } from "../env";
import { getForm } from "../forms";
import { parseFormRow } from "../forms/schema";
import { enqueue, PermanentJobError } from "../jobs";
import { getProjectById, getTestimonial } from "../testimonials";
import { type EventContext, registerEventListener } from "../webhooks";
import { CHANNEL_EVENTS, type ChannelEvent, channelEvents, channelFormIds, ChannelGoneError, getChannel, listChannels, noteResult, sendToChannel } from "./channels";
import { digestMail, importMail, instantMail, type MailKind, monthlyMail, sendNotificationMail, weeklyMail, widgetRemovedMail } from "./email";
import { buildMessage } from "./format";
import { canEmail, getPrefs, type Prefs, recipients, wantsProject } from "./prefs";

const { memberPrefs, testimonials, taskRuns } = schema;

/**
 * Notifications (INT-01, INT-02) hear every event through the webhooks
 * listener hook, so webhooks.ts never changes for them. The listener only
 * decides who should hear and queues jobs; sending happens in the worker, with
 * retries, so a slow chat service never holds up a submission.
 */

export const NOTIFY_CHANNEL_JOB = "notify.channel";
export const NOTIFY_EMAIL_JOB = "notify.email";
const ATTEMPTS = 4;
/** The most testimonials one digest lists. */
const DIGEST_MAX = 50;

/** Testimonials the owner added or imported themselves: nobody needs telling about those. */
export function isQuietSource(source: string | null | undefined) {
  return source === "manual" || (source ?? "").startsWith("import");
}

/** Active chat channels that want this event for this project and form, with the form's own choice applied. */
export function channelsFor(event: ChannelEvent, projectId: string, formId: string | null) {
  let formChoice: "all" | string[] = "all";
  if (formId) {
    const form = getForm(formId);
    if (form) formChoice = parseFormRow(form).settings.notify.channelIds;
  }
  return listChannels({ projectId }).filter((c) => {
    if (!c.active || !channelEvents(c).includes(event)) return false;
    const only = channelFormIds(c);
    if (only.length && (!formId || !only.includes(formId))) return false;
    return formChoice === "all" || formChoice.includes(c.id);
  });
}

function onImportCompleted(project: Project) {
  const run = getDb()
    .select()
    .from(taskRuns)
    .where(and(eq(taskRuns.projectId, project.id), eq(taskRuns.kind, "import"), eq(taskRuns.status, "done")))
    .orderBy(desc(taskRuns.finishedAt))
    .limit(1)
    .get();
  if (!run) return;
  for (const r of recipients((p) => p.importSummary && wantsProject(p, project.id))) {
    enqueue(NOTIFY_EMAIL_JOB, { email: r.email, kind: "import", runId: run.id }, { maxAttempts: ATTEMPTS });
  }
}

/** The listener: never throws, never sends anything itself. */
export function notifyEvent(event: WebhookEvent, ctx: EventContext): void {
  try {
    if (ctx.quiet) return;
    if (event === "import.completed") return onImportCompleted(ctx.project);
    const t = ctx.testimonial;
    if (!t || !(CHANNEL_EVENTS as readonly string[]).includes(event) || isQuietSource(t.source)) return;
    for (const c of channelsFor(event as ChannelEvent, ctx.project.id, t.formId ?? ctx.formId)) {
      enqueue(NOTIFY_CHANNEL_JOB, { channelId: c.id, testimonialId: t.id, event }, { maxAttempts: ATTEMPTS });
    }
    if (event === "testimonial.created") {
      for (const r of recipients((p) => p.newTestimonial === "instant" && wantsProject(p, ctx.project.id))) {
        enqueue(NOTIFY_EMAIL_JOB, { email: r.email, kind: "instant", ids: [t.id] }, { maxAttempts: ATTEMPTS });
      }
    }
  } catch (err) {
    console.error(`[notifications] couldn't queue ${event}:`, err);
  }
}

registerEventListener(notifyEvent);

/** DISP-13: the analytics job found a widget gone for 7 days; email whoever asked for it. Never throws. */
export function notifyWidgetRemoved(projectId: string, widgetId: string): void {
  try {
    for (const r of recipients((p) => p.widgetRemoved && wantsProject(p, projectId))) {
      enqueue(NOTIFY_EMAIL_JOB, { email: r.email, kind: "widget-removed", widgetId }, { maxAttempts: ATTEMPTS });
    }
  } catch (err) {
    console.error("[notifications] couldn't queue widget.removed:", err);
  }
}

// ------------------------------------------------------------------- jobs

type ChannelJob = { channelId: string; testimonialId: string; event: string };

export async function deliverChannelJob(p: ChannelJob, o: { final?: boolean } = {}) {
  const c = getChannel(p.channelId);
  const t = getTestimonial(p.testimonialId);
  if (!c || !c.active || !t || t.status === "trashed") return;
  const project = getProjectById(t.projectId);
  if (!project) return;
  try {
    await sendToChannel(c, buildMessage(project, t, p.event));
    noteResult(c.id, null);
  } catch (err) {
    const message = (err as Error).message || "Couldn't send";
    // Refused by the guard, a redirect, or a 4xx: retrying won't help (ChannelGoneError is one of these).
    const permanent = err instanceof PermanentJobError || err instanceof ChannelGoneError;
    if (permanent || o.final) noteResult(c.id, message);
    if (permanent) throw new PermanentJobError(message);
    throw err;
  }
}

type EmailJob = { email: string; kind: MailKind; ids?: string[]; projectIds?: string[]; runId?: string; widgetId?: string; now?: number };

/** Still allowed and still wanted when it's time to send (prefs can change while a job waits). */
function stillWanted(kind: MailKind, prefs: Prefs) {
  switch (kind) {
    case "instant":
      return prefs.newTestimonial === "instant";
    case "daily":
      return prefs.newTestimonial === "daily";
    case "weekly":
      return prefs.weeklyPending;
    case "monthly":
      return prefs.monthlyReport;
    case "import":
      return prefs.importSummary;
    case "widget-removed":
      return prefs.widgetRemoved;
  }
}

export async function deliverEmailJob(p: EmailJob) {
  if (!p.email || !canEmail(p.email)) return;
  const prefs = getPrefs(p.email);
  if (!stillWanted(p.kind, prefs)) return;
  let mail: ReturnType<typeof instantMail> = null;
  if (p.kind === "instant") {
    const t = p.ids?.[0] ? getTestimonial(p.ids[0]) : null;
    if (t && wantsProject(prefs, t.projectId)) mail = instantMail(p.email, t.id);
  } else if (p.kind === "daily") {
    const ids = (p.ids ?? []).filter((id) => {
      const t = getTestimonial(id);
      return t && wantsProject(prefs, t.projectId);
    });
    mail = digestMail(p.email, ids);
  } else if (p.kind === "weekly") {
    mail = weeklyMail(p.email, prefs.projectIds);
  } else if (p.kind === "monthly") {
    mail = monthlyMail(p.email, prefs.projectIds, new Date(p.now ?? Date.now()));
  } else if (p.kind === "import" && p.runId) {
    const run = getDb().select().from(taskRuns).where(eq(taskRuns.id, p.runId)).get();
    if (run && wantsProject(prefs, run.projectId)) mail = importMail(p.email, run);
  } else if (p.kind === "widget-removed" && p.widgetId) {
    const w = getDb().select({ projectId: schema.widgets.projectId }).from(schema.widgets).where(eq(schema.widgets.id, p.widgetId)).get();
    if (w && wantsProject(prefs, w.projectId)) mail = widgetRemovedMail(p.email, p.widgetId);
  }
  await sendNotificationMail(mail);
}

/** For the plan's single entry point: one channel or one person, one kind. */
export async function deliverNotification(p: { channelId?: string; email?: string; kind: MailKind; ids: string[] }) {
  if (p.channelId) {
    for (const id of p.ids) await deliverChannelJob({ channelId: p.channelId, testimonialId: id, event: "testimonial.created" });
    return;
  }
  if (p.email) await deliverEmailJob({ email: p.email, kind: p.kind, ids: p.ids });
}

// ---------------------------------------------------------------- digests

const DAY = 24 * 60 * 60 * 1000;

/** The latest daily send time (DIGEST_HOUR_UTC) at or before `now`. */
export function dailyBoundary(now: Date, hour = env.digestHourUtc) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
  return d.getTime() > now.getTime() ? new Date(d.getTime() - DAY) : d;
}

/** The latest Monday send time at or before `now`. */
export function weeklyBoundary(now: Date, hour = env.digestHourUtc) {
  let d = dailyBoundary(now, hour);
  while (d.getUTCDay() !== 1) d = new Date(d.getTime() - DAY);
  return d;
}

/** The latest 1st-of-the-month send time at or before `now`. */
export function monthlyBoundary(now: Date, hour = env.digestHourUtc) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, hour));
  return d.getTime() > now.getTime() ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, hour)) : d;
}

type Clock = "lastDigestAt" | "lastWeeklyAt" | "lastMonthlyAt";

/**
 * Moves one person's clock to `now` if it's before `boundary`. Only the call
 * that moves it sends, so running this twice (or from two workers) mails once.
 */
function claim(tx: Tx, email: string, clock: Clock, boundary: Date, now: Date) {
  const col = memberPrefs[clock];
  const res = tx
    .update(memberPrefs)
    .set({ [clock]: now })
    .where(and(eq(memberPrefs.email, email), or(isNull(col), lt(col, boundary))))
    .run();
  return res.changes === 1;
}

function newSince(projectIds: string[], since: Date, until: Date) {
  return getDb()
    .select({ id: testimonials.id })
    .from(testimonials)
    .where(
      and(
        gte(testimonials.createdAt, since),
        lt(testimonials.createdAt, until),
        ne(testimonials.status, "trashed"),
        ne(testimonials.source, "manual"),
        notLike(testimonials.source, "import%"),
        ...(projectIds.length ? [inArray(testimonials.projectId, projectIds)] : []),
      ),
    )
    .orderBy(sql`${testimonials.createdAt} asc`)
    .limit(DIGEST_MAX)
    .all()
    .map((r) => r.id);
}

/**
 * The scheduled emails (runs every 15 minutes): the daily digest after
 * DIGEST_HOUR_UTC, the weekly pending reminder on Mondays and the monthly
 * report on the 1st. Idempotent through member_prefs.last*At. Returns how
 * many emails it queued.
 */
export function runDigests(now = new Date()): number {
  let queued = 0;
  const db = getDb();
  const day = dailyBoundary(now);
  const week = weeklyBoundary(now);
  const month = monthlyBoundary(now);
  for (const r of recipients((p) => p.newTestimonial === "daily" || p.weeklyPending || p.monthlyReport)) {
    const { email, prefs, row } = r;
    db.transaction((tx) => {
      if (prefs.newTestimonial === "daily" && claim(tx, email, "lastDigestAt", day, now)) {
        const since = row.lastDigestAt ?? new Date(now.getTime() - DAY);
        const ids = newSince(prefs.projectIds, since, now);
        if (ids.length) {
          enqueue(NOTIFY_EMAIL_JOB, { email, kind: "daily", ids }, { maxAttempts: ATTEMPTS });
          queued++;
        }
      }
      if (prefs.weeklyPending && claim(tx, email, "lastWeeklyAt", week, now)) {
        enqueue(NOTIFY_EMAIL_JOB, { email, kind: "weekly" }, { maxAttempts: ATTEMPTS });
        queued++;
      }
      if (prefs.monthlyReport && claim(tx, email, "lastMonthlyAt", month, now)) {
        enqueue(NOTIFY_EMAIL_JOB, { email, kind: "monthly", now: now.getTime() }, { maxAttempts: ATTEMPTS });
        queued++;
      }
    });
  }
  return queued;
}

export { getPrefs, setPrefs } from "./prefs";
