import crypto from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Campaign, Form, Project, TestimonialRequest } from "@/db/schema";
import { renderCampaignEmail } from "./campaign-email";
import { parseCsv } from "./csv";
import { emailEnabled, fillTemplate, headerSafe, isPermanentSmtpError, isRecipientRejection, sendMail } from "./email";
import { env } from "./env";
import { formUrl, getForm } from "./forms";
import { parseFormRow } from "./forms/schema";
import { enqueue, PermanentJobError } from "./jobs";
import { emitEvent } from "./webhooks";

const { requests, projects, campaigns, unsubscribes } = schema;

/**
 * Personal testimonial requests. Each one gets a signed link that prefills
 * the form, an optional invitation email, and up to a few reminders that stop
 * as soon as the person responds or unsubscribes.
 */
export const SEND_EMAIL_JOB = "email.send";

export const DEFAULT_INVITE_SUBJECT = "Would you share a few words about {project}?";
export const DEFAULT_INVITE_MESSAGE = `Hi {name},

Thanks for being a customer of {project}. Would you share a short testimonial? It takes about two minutes: write a few lines or record a quick video, whichever you prefer.

{link}

Thank you!`;

const MAX_REMINDERS = 3;
const DAY = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------------ links

function sign(purpose: string, id: string) {
  return crypto.createHmac("sha256", env.sessionSecret).update(`${purpose}:${id}`).digest("base64url").slice(0, 22);
}

/** What a signed link is for; each purpose has its own signature, so one can't stand in for another. */
type Purpose = "request" | "unsubscribe" | "decline" | "open";

/** `<id>.<signature>`; changing SESSION_SECRET invalidates old links. */
function token(purpose: Purpose, id: string) {
  return `${id}.${sign(purpose, id)}`;
}

function verify(purpose: Purpose, value: string | null | undefined) {
  const [id, sig] = (value ?? "").split(".");
  if (!id || !sig || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const expected = Buffer.from(sign(purpose, id));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return getDb().select().from(requests).where(eq(requests.id, id)).get() ?? null;
}

export const requestToken = (id: string) => token("request", id);
export const unsubscribeToken = (id: string) => token("unsubscribe", id);
export const findRequestByToken = (value: string | null | undefined) => verify("request", value);
export const findRequestByUnsubscribeToken = (value: string | null | undefined) => verify("unsubscribe", value);
export const declineToken = (id: string) => token("decline", id);
export const findRequestByDeclineToken = (value: string | null | undefined) => verify("decline", value);
export const openToken = (id: string) => token("open", id);
export const findRequestByOpenToken = (value: string | null | undefined) => verify("open", value);

/**
 * The personal link: the request's form when it has one (/f/<project>/<form>),
 * otherwise the project's default form, which /c/<project> opens (and sends
 * on to /f when the default is step by step, ?r= kept).
 */
export function requestLink(project: Pick<Project, "slug">, id: string, form?: Pick<Form, "slug" | "isDefault" | "layout"> | null) {
  const path = form ? formUrl(project, form) : `/c/${project.slug}`;
  return `${env.publicUrl}${path}?r=${requestToken(id)}`;
}

/** The request's own form, if it still belongs to the project. */
function formOf(project: Pick<Project, "id">, r: { formId?: string | null }) {
  const form = r.formId ? getForm(r.formId) : null;
  return form && form.projectId === project.id ? form : null;
}

/** A request as the dashboard sees it: with its personal link. */
export function withLink<T extends { id: string; formId?: string | null }>(project: Pick<Project, "id" | "slug">, r: T) {
  return { ...r, link: requestLink(project, r.id, formOf(project, r)) };
}

export function unsubscribeLink(id: string) {
  return `${env.publicUrl}/u/${unsubscribeToken(id)}`;
}

/** Campaign emails link through /r, which records the click and sends the person on to their form. */
export function clickLink(id: string) {
  return `${env.publicUrl}/r/${requestToken(id)}`;
}

export function declineLink(id: string) {
  return `${env.publicUrl}/d/${declineToken(id)}`;
}

export function openPixelUrl(id: string) {
  return `${env.publicUrl}/api/open/${openToken(id)}`;
}

// ------------------------------------------------------------------ unsubscribes

/**
 * Unsubscribing is project-wide, by email (M9): it stops every request and
 * campaign of the project for that address, and later imports skip it.
 */
export function isUnsubscribed(projectId: string, email: string) {
  return Boolean(
    getDb()
      .select({ email: unsubscribes.email })
      .from(unsubscribes)
      .where(and(eq(unsubscribes.projectId, projectId), eq(unsubscribes.email, email.toLowerCase())))
      .get(),
  );
}

/** The project's unsubscribed addresses among `emails` (lower-cased). */
export function unsubscribedAmong(projectId: string, emails: string[]) {
  const lower = [...new Set(emails.map((e) => e.toLowerCase()))];
  if (!lower.length) return new Set<string>();
  const rows = getDb()
    .select({ email: unsubscribes.email })
    .from(unsubscribes)
    .where(and(eq(unsubscribes.projectId, projectId), inArray(unsubscribes.email, lower)))
    .all();
  return new Set(rows.map((r) => r.email));
}

// ------------------------------------------------------------------ input

const email = z.email();

export type RequestRow = { name?: string; email: string; company?: string };

/**
 * Reads pasted lines or a CSV export. With a header row containing "email",
 * columns are matched by name; otherwise it's `name, email, company`.
 */
export function parseRecipients(input: string) {
  const rows = parseCsv(input);
  const valid: RequestRow[] = [];
  const invalid: string[] = [];
  if (rows.length === 0) return { valid, invalid };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const hasHeader = header.some((h) => h.includes("email"));
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const idx = hasHeader
    ? { name: col("name", "full name"), email: col("email"), company: col("company", "organisation", "organization") }
    : { name: 0, email: 1, company: 2 };
  for (const r of hasHeader ? rows.slice(1) : rows) {
    // A single column of bare addresses is fine too.
    const cells = r.map((c) => c.trim());
    const address = (!hasHeader && cells.length === 1 ? cells[0] : cells[idx.email] ?? "").toLowerCase();
    if (!email.safeParse(address).success) {
      invalid.push(cells.join(", "));
      continue;
    }
    valid.push({
      email: address,
      name: (!hasHeader && cells.length === 1 ? "" : cells[idx.name] ?? "").slice(0, 120) || undefined,
      company: (cells[idx.company] ?? "").slice(0, 120) || undefined,
    });
  }
  return { valid, invalid };
}

/** "3, 7" -> [3, 7]; at most three positive whole days, ascending. */
export function parseReminderDays(value: string) {
  return [...new Set(value.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 60))]
    .sort((a, b) => a - b)
    .slice(0, MAX_REMINDERS);
}

// ------------------------------------------------------------------ CRUD

/**
 * The project's requests, newest first. `campaignId: null` keeps the Requests
 * tab's own (no campaign); a campaign id gives that campaign's recipients.
 */
export function listRequests(projectId: string, o: { campaignId?: string | null } = {}) {
  const where = [eq(requests.projectId, projectId)];
  if (o.campaignId === null) where.push(isNull(requests.campaignId));
  else if (o.campaignId) where.push(eq(requests.campaignId, o.campaignId));
  return getDb().select().from(requests).where(and(...where)).orderBy(desc(requests.createdAt)).all();
}

export function getRequest(id: string) {
  return getDb().select().from(requests).where(eq(requests.id, id)).get() ?? null;
}

export function deleteRequest(id: string) {
  return getDb().delete(requests).where(eq(requests.id, id)).returning().get() ?? null;
}

/**
 * Creates requests, skipping people who already have an open request or
 * unsubscribed from this project. Optionally queues invitation emails.
 */
export function createRequests(project: Project, rows: RequestRow[], opts: { send: boolean; formId?: string | null }) {
  const db = getDb();
  const emails = [...new Set(rows.map((r) => r.email))];
  const existing = emails.length
    ? db.select().from(requests).where(and(eq(requests.projectId, project.id), inArray(requests.email, emails))).all()
    : [];
  const blocked = new Map(
    existing.filter((r) => r.status !== "responded").map((r) => [r.email, r.status === "unsubscribed" ? "unsubscribed" : "duplicate"]),
  );
  // Unsubscribing is project-wide, and outlives a deleted request.
  for (const address of unsubscribedAmong(project.id, emails)) blocked.set(address, "unsubscribed");
  const created: TestimonialRequest[] = [];
  const skipped: { email: string; reason: "duplicate" | "unsubscribed" }[] = [];
  for (const row of rows) {
    const reason = blocked.get(row.email);
    if (reason) {
      skipped.push({ email: row.email, reason: reason as "duplicate" | "unsubscribed" });
      continue;
    }
    blocked.set(row.email, "duplicate");
    const r = db
      .insert(requests)
      .values({
        id: crypto.randomUUID(),
        projectId: project.id,
        email: row.email,
        name: row.name ?? null,
        company: row.company ?? null,
        formId: opts.formId ?? null,
        createdAt: new Date(),
      })
      .returning()
      .get();
    created.push(opts.send ? queueInvite(project, r) : r);
  }
  return { created, skipped };
}

// ------------------------------------------------------------------ email

export type EmailKind = "invite" | "reminder";

function inviteEmail(project: Project, r: TestimonialRequest, kind: EmailKind) {
  const values = {
    name: r.name?.split(" ")[0] || "there",
    project: project.name,
    link: requestLink(project, r.id, formOf(project, r)),
  };
  const subject = fillTemplate(project.inviteSubject.trim() || DEFAULT_INVITE_SUBJECT, values);
  let body = fillTemplate(project.inviteMessage.trim() || DEFAULT_INVITE_MESSAGE, values);
  // Make sure the link is in the message even if the owner's template dropped it.
  if (!body.includes(values.link)) body += `\n\n${values.link}`;
  if (kind === "reminder") body = `Just a gentle reminder in case this got buried.\n\n${body}`;
  const unsubscribe = unsubscribeLink(r.id);
  return {
    to: r.email,
    subject: kind === "reminder" ? `Reminder: ${subject}` : subject,
    text: `${body}\n\n--\nYou're getting this because ${headerSafe(project.name)} asked for your feedback. To stop these emails: ${unsubscribe}\n`,
    headers: {
      // One-click unsubscribe (RFC 8058) for mail apps that support it.
      "List-Unsubscribe": `<${env.publicUrl}/api/unsubscribe/${unsubscribeToken(r.id)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

/** The custom template variables saved with a campaign recipient. */
export function parseCustom(raw: string): Record<string, string> {
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

/** A campaign's reminder schedule: up to three whole days after the invitation, ascending. */
export function parseReminderList(raw: string): number[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? parseReminderDays(v.filter((n) => typeof n === "number").join(",")) : [];
  } catch {
    return [];
  }
}

/**
 * The campaign email for one recipient: what the worker sends, and (with
 * `preview`) the dashboard's preview of it, which leaves out only the open pixel.
 */
export function campaignEmail(
  project: Project,
  campaign: Pick<Campaign, "subject" | "body" | "buttonText" | "rtl" | "senderName" | "replyTo" | "trackOpens">,
  r: TestimonialRequest,
  kind: EmailKind,
  o: { preview?: boolean } = {},
) {
  return renderCampaignEmail({
    projectName: project.name,
    accentColor: project.accentColor,
    content: campaign,
    recipient: { name: r.name, email: r.email, company: r.company, title: r.title, custom: parseCustom(r.custom) },
    links: {
      link: clickLink(r.id),
      decline: declineLink(r.id),
      unsubscribe: unsubscribeLink(r.id),
      oneClick: `${env.publicUrl}/api/unsubscribe/${unsubscribeToken(r.id)}`,
      open: campaign.trackOpens && !o.preview ? openPixelUrl(r.id) : null,
    },
    kind,
  });
}

function update(id: string, fields: Partial<typeof requests.$inferInsert>) {
  return getDb().update(requests).set(fields).where(eq(requests.id, id)).returning().get();
}

function campaignOf(r: Pick<TestimonialRequest, "campaignId">) {
  return r.campaignId ? (getDb().select().from(campaigns).where(eq(campaigns.id, r.campaignId)).get() ?? null) : null;
}

/**
 * Queues the invitation (again). Resets the reminder schedule. `delayMs`
 * holds it back (auto-collect's "send N days later").
 */
export function queueInvite(project: Project, r: TestimonialRequest, o: { delayMs?: number } = {}) {
  if (!emailEnabled()) throw new Error("Email isn't set up on this server (SMTP_URL)");
  const runAt = o.delayMs ? new Date(Date.now() + o.delayMs) : undefined;
  enqueue(SEND_EMAIL_JOB, { requestId: r.id, kind: "invite" satisfies EmailKind }, { maxAttempts: 4, runAt });
  return update(r.id, { emailStatus: "queued", emailError: null, remindersSent: 0, nextReminderAt: null, scheduledFor: runAt ?? null });
}

/** Job handler for invitations and reminders. */
export async function sendRequestEmail(payload: { requestId: string; kind: EmailKind }, final: boolean) {
  const r = getRequest(payload.requestId);
  if (!r) return; // deleted
  if (r.status !== "waiting") return; // responded, unsubscribed or declined meanwhile
  const project = getDb().select().from(projects).where(eq(projects.id, r.projectId)).get();
  if (!project) return;
  if (isUnsubscribed(project.id, r.email)) {
    // Unsubscribed through another request or campaign of this project.
    update(r.id, { status: "unsubscribed", unsubscribedAt: new Date(), nextReminderAt: null, emailStatus: r.sentAt ? "sent" : "not_sent", scheduledFor: null });
    return;
  }
  const campaign = campaignOf(r);
  if (r.campaignId && !campaign) return; // the campaign was deleted
  if (campaign && campaign.status !== "active") {
    // Paused (or back to draft): nothing goes out. Resuming queues it again.
    update(r.id, payload.kind === "invite" ? { emailStatus: "not_sent", scheduledFor: null } : { emailStatus: "sent", nextReminderAt: new Date() });
    return;
  }
  try {
    await sendMail(campaign ? campaignEmail(project, campaign, r, payload.kind) : inviteEmail(project, r, payload.kind));
  } catch (err) {
    // A refused login, sender or address fails the same way every time: stop now.
    const permanent = isPermanentSmtpError(err) || (err instanceof Error && /isn't set up/.test(err.message));
    // A campaign shows an address the server refused for good as bounced.
    const gaveUp = campaign && permanent && isRecipientRejection(err) ? "bounced" : "failed";
    update(r.id, { emailStatus: final || permanent ? gaveUp : "queued", emailError: (err as Error).message.slice(0, 300) });
    if (permanent) throw new PermanentJobError((err as Error).message);
    throw err;
  }
  const now = new Date();
  const sentAt = payload.kind === "invite" ? now : (r.sentAt ?? now);
  const remindersSent = payload.kind === "reminder" ? r.remindersSent + 1 : 0;
  const schedule = campaign ? parseReminderList(campaign.reminders) : parseReminderDays(project.reminderDays);
  const next = schedule[remindersSent];
  const sent = update(r.id, {
    emailStatus: "sent",
    emailError: null,
    sentAt,
    scheduledFor: null,
    remindersSent,
    nextReminderAt: next ? new Date(sentAt.getTime() + next * DAY) : null,
  });
  if (sent) emitInvite("invite.sent", project, sent, { kind: payload.kind });
}

/** Periodic task: queues reminders that are due. */
export function queueDueReminders(now = new Date()) {
  if (!emailEnabled()) return 0;
  const due = getDb()
    .select()
    .from(requests)
    .where(and(eq(requests.status, "waiting"), isNotNull(requests.nextReminderAt), lte(requests.nextReminderAt, now)))
    .all();
  const paused = new Set(
    getDb()
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(inArray(campaigns.status, ["draft", "paused"]))
      .all()
      .map((c) => c.id),
  );
  for (const r of due) {
    // A paused campaign's reminders wait; they go out once it's resumed.
    if (r.campaignId && paused.has(r.campaignId)) continue;
    // Clear the due time first so a slow send can't queue the same reminder twice.
    update(r.id, { nextReminderAt: null, emailStatus: "queued" });
    enqueue(SEND_EMAIL_JOB, { requestId: r.id, kind: "reminder" satisfies EmailKind }, { maxAttempts: 4 });
  }
  return due.filter((r) => !(r.campaignId && paused.has(r.campaignId))).length;
}

// ------------------------------------------------------------------ outcomes

/** Links a submission to its request and stops further reminders. */
export function markResponded(r: TestimonialRequest, testimonialId: string) {
  return update(r.id, {
    status: r.status === "unsubscribed" ? "unsubscribed" : "responded",
    respondedAt: new Date(),
    testimonialId,
    nextReminderAt: null,
  });
}

/**
 * Stops email to this address from the whole project (M9): the address is
 * remembered, and every request or campaign still waiting on it stops.
 */
export function unsubscribe(r: TestimonialRequest) {
  const db = getDb();
  const now = new Date();
  const email = r.email.toLowerCase();
  db.insert(unsubscribes).values({ projectId: r.projectId, email, createdAt: now }).onConflictDoNothing().run();
  db.update(requests)
    .set({ status: "unsubscribed", unsubscribedAt: now, nextReminderAt: null })
    .where(and(eq(requests.projectId, r.projectId), eq(requests.email, email), inArray(requests.status, ["waiting", "declined"]), isNull(requests.unsubscribedAt)))
    .run();
  if (r.unsubscribedAt) return getRequest(r.id) ?? r;
  // A person who already responded keeps that status; the date still records the unsubscribe.
  return update(r.id, { unsubscribedAt: r.unsubscribedAt ?? now, nextReminderAt: null }) ?? r;
}

// ------------------------------------------------------------------ tracking (M9, REQ-04 and REQ-05)

/** Invite webhooks (opt-in events): the recipient, with their campaign. */
function emitInvite(event: "invite.sent" | "invite.opened" | "invite.clicked" | "invite.declined", project: Project, r: TestimonialRequest, extra: object = {}) {
  emitEvent(event, project, { invite: inviteToApi(project, r), ...extra }, { formId: r.formId });
}

function projectOf(r: TestimonialRequest) {
  return getDb().select().from(projects).where(eq(projects.id, r.projectId)).get() ?? null;
}

/** The first press of the personal link. Later presses change nothing. */
export function markClicked(r: TestimonialRequest) {
  if (r.clickedAt) return r;
  const row = getDb().update(requests).set({ clickedAt: new Date() }).where(and(eq(requests.id, r.id), isNull(requests.clickedAt))).returning().get();
  const project = row && projectOf(row);
  if (row && project) emitInvite("invite.clicked", project, row);
  return row ?? r;
}

/** The first open, only for a campaign that turned open tracking on. */
export function markOpened(r: TestimonialRequest) {
  if (r.openedAt || !campaignOf(r)?.trackOpens) return r;
  const row = getDb().update(requests).set({ openedAt: new Date() }).where(and(eq(requests.id, r.id), isNull(requests.openedAt))).returning().get();
  const project = row && projectOf(row);
  if (row && project) emitInvite("invite.opened", project, row);
  return row ?? r;
}

/** The form was opened with this request's token (the link's prefill). */
export function markStarted(r: TestimonialRequest) {
  if (r.startedAt) return r;
  return getDb().update(requests).set({ startedAt: new Date() }).where(and(eq(requests.id, r.id), isNull(requests.startedAt))).returning().get() ?? r;
}

/** "No thanks": no more reminders for this request. Someone who already responded stays responded. */
export function decline(r: TestimonialRequest) {
  if (r.status !== "waiting") return r;
  const row = update(r.id, { status: "declined", declinedAt: new Date(), nextReminderAt: null });
  const project = row && projectOf(row);
  if (row && project) emitInvite("invite.declined", project, row);
  return row ?? r;
}

/** Where a recipient is, furthest step first: what the campaign page and the API show. */
export function inviteStage(r: TestimonialRequest) {
  if (r.status === "responded") return "submitted";
  if (r.status === "declined") return "declined";
  if (r.status === "unsubscribed") return "unsubscribed";
  if (r.startedAt) return "started";
  if (r.clickedAt) return "clicked";
  if (r.openedAt) return "opened";
  if (r.emailStatus === "bounced" || r.emailStatus === "failed") return r.emailStatus;
  if (r.emailStatus === "sent") return "sent";
  if (r.emailStatus === "queued") return "queued";
  return "not_sent";
}
export type InviteStage = ReturnType<typeof inviteStage>;

/** A recipient as the API and the invite webhooks show them. */
export function inviteToApi(project: Project, r: TestimonialRequest) {
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return {
    id: r.id,
    campaignId: r.campaignId,
    email: r.email,
    name: r.name,
    company: r.company,
    title: r.title,
    variables: parseCustom(r.custom),
    stage: inviteStage(r),
    status: r.status,
    emailStatus: r.emailStatus,
    scheduledFor: iso(r.scheduledFor),
    sentAt: iso(r.sentAt),
    remindersSent: r.remindersSent,
    openedAt: iso(r.openedAt),
    clickedAt: iso(r.clickedAt),
    startedAt: iso(r.startedAt),
    respondedAt: iso(r.respondedAt),
    declinedAt: iso(r.declinedAt),
    unsubscribedAt: iso(r.unsubscribedAt),
    testimonialId: r.testimonialId,
    link: requestLink(project, r.id, formOf(project, r)),
    createdAt: r.createdAt.toISOString(),
  };
}

// ------------------------------------------------------------------ receipts

export const THANK_YOU_JOB = "email.thank-you";

/**
 * After a submission that came through a personal request link: a receipt
 * with the private withdrawal link, sent to the address the owner invited.
 * Open-form submissions get no email, so the public form can't be used to
 * send mail from the owner's server to arbitrary addresses. `form` is the
 * form it was sent through: its confirmation setting and template apply.
 */
export function queueThankYou(project: Project, request: TestimonialRequest | null, withdrawUrl: string, form?: Form | null) {
  const to = request?.email;
  const enabled = form ? parseFormRow(form).settings.confirmationEmail.enabled : project.thankYouEmail;
  if (!to || !enabled || !emailEnabled()) return false;
  enqueue(THANK_YOU_JOB, { projectId: project.id, to, withdrawUrl, ...(form ? { formId: form.id } : {}) }, { maxAttempts: 4 });
  return true;
}

export async function sendThankYou(payload: { projectId: string; to: string; withdrawUrl: string; formId?: string }) {
  const project = getDb().select().from(projects).where(eq(projects.id, payload.projectId)).get();
  if (!project) return;
  const form = payload.formId ? getForm(payload.formId) : null;
  const settings = form && form.projectId === project.id ? parseFormRow(form).settings : null;
  const autoApproves = settings ? settings.autoApprove.mode !== "off" : project.autoApprove;
  const values = { project: project.name, link: payload.withdrawUrl };
  const subject = settings?.confirmationEmail.subject.trim();
  let body = settings?.confirmationEmail.body.trim() ? fillTemplate(settings.confirmationEmail.body, values) : null;
  // The withdrawal link is always in the mail, even if the owner's template dropped it.
  if (body && !body.includes(payload.withdrawUrl)) body += `\n\nTo withdraw your testimonial at any time: ${payload.withdrawUrl}`;
  try {
    await sendMail({
      to: payload.to,
      subject: subject ? headerSafe(fillTemplate(subject, values)) : `Thanks for your testimonial for ${project.name}`,
      // With auto-approve on it may go live without a review, so don't promise one.
      text:
        body ??
        `Thank you for taking the time to share your experience with ${project.name}. ${
          autoApproves ? "It may appear on their website soon." : "They'll review it before it appears anywhere."
        }

If you change your mind, you can withdraw your testimonial at any time with this private link:
${payload.withdrawUrl}

Keep this email: anyone with the link can withdraw the testimonial.
`,
    });
  } catch (err) {
    if (isPermanentSmtpError(err)) throw new PermanentJobError((err as Error).message);
    throw err;
  }
}
