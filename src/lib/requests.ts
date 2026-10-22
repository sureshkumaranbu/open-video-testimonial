import crypto from "node:crypto";
import { and, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Project, TestimonialRequest } from "@/db/schema";
import { parseCsv } from "./csv";
import { emailEnabled, fillTemplate, headerSafe, sendMail } from "./email";
import { env } from "./env";
import { enqueue, PermanentJobError } from "./jobs";

const { requests, projects } = schema;

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

/** `<id>.<signature>`; changing SESSION_SECRET invalidates old links. */
function token(purpose: "request" | "unsubscribe", id: string) {
  return `${id}.${sign(purpose, id)}`;
}

function verify(purpose: "request" | "unsubscribe", value: string | null | undefined) {
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

export function requestLink(project: Pick<Project, "slug">, id: string) {
  return `${env.publicUrl}/c/${project.slug}?r=${requestToken(id)}`;
}

/** A request as the dashboard sees it: with its personal link. */
export function withLink<T extends { id: string }>(project: Pick<Project, "slug">, r: T) {
  return { ...r, link: requestLink(project, r.id) };
}

export function unsubscribeLink(id: string) {
  return `${env.publicUrl}/u/${unsubscribeToken(id)}`;
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

export function listRequests(projectId: string) {
  return getDb().select().from(requests).where(eq(requests.projectId, projectId)).orderBy(desc(requests.createdAt)).all();
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
export function createRequests(project: Project, rows: RequestRow[], opts: { send: boolean }) {
  const db = getDb();
  const emails = [...new Set(rows.map((r) => r.email))];
  const existing = emails.length
    ? db.select().from(requests).where(and(eq(requests.projectId, project.id), inArray(requests.email, emails))).all()
    : [];
  const blocked = new Map(
    existing.filter((r) => r.status !== "responded").map((r) => [r.email, r.status === "unsubscribed" ? "unsubscribed" : "duplicate"]),
  );
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
        createdAt: new Date(),
      })
      .returning()
      .get();
    created.push(opts.send ? queueInvite(project, r) : r);
  }
  return { created, skipped };
}

// ------------------------------------------------------------------ email

type EmailKind = "invite" | "reminder";

function inviteEmail(project: Project, r: TestimonialRequest, kind: EmailKind) {
  const values = {
    name: r.name?.split(" ")[0] || "there",
    project: project.name,
    link: requestLink(project, r.id),
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

function update(id: string, fields: Partial<typeof requests.$inferInsert>) {
  return getDb().update(requests).set(fields).where(eq(requests.id, id)).returning().get();
}

/** Queues the invitation (again). Resets the reminder schedule. */
export function queueInvite(project: Project, r: TestimonialRequest) {
  if (!emailEnabled()) throw new Error("Email isn't set up on this server (SMTP_URL)");
  enqueue(SEND_EMAIL_JOB, { requestId: r.id, kind: "invite" satisfies EmailKind }, { maxAttempts: 4 });
  return update(r.id, { emailStatus: "queued", emailError: null, remindersSent: 0, nextReminderAt: null });
}

/** Job handler for invitations and reminders. */
export async function sendRequestEmail(payload: { requestId: string; kind: EmailKind }, final: boolean) {
  const r = getRequest(payload.requestId);
  if (!r) return; // deleted
  if (r.status !== "waiting") return; // responded or unsubscribed meanwhile
  const project = getDb().select().from(projects).where(eq(projects.id, r.projectId)).get();
  if (!project) return;
  try {
    await sendMail(inviteEmail(project, r, payload.kind));
  } catch (err) {
    update(r.id, { emailStatus: final ? "failed" : "queued", emailError: (err as Error).message.slice(0, 300) });
    if (err instanceof Error && /isn't set up/.test(err.message)) throw new PermanentJobError(err.message);
    throw err;
  }
  const now = new Date();
  const sentAt = payload.kind === "invite" ? now : (r.sentAt ?? now);
  const remindersSent = payload.kind === "reminder" ? r.remindersSent + 1 : 0;
  const schedule = parseReminderDays(project.reminderDays);
  const next = schedule[remindersSent];
  update(r.id, {
    emailStatus: "sent",
    emailError: null,
    sentAt,
    remindersSent,
    nextReminderAt: next ? new Date(sentAt.getTime() + next * DAY) : null,
  });
}

/** Periodic task: queues reminders that are due. */
export function queueDueReminders(now = new Date()) {
  if (!emailEnabled()) return 0;
  const due = getDb()
    .select()
    .from(requests)
    .where(and(eq(requests.status, "waiting"), isNotNull(requests.nextReminderAt), lte(requests.nextReminderAt, now)))
    .all();
  for (const r of due) {
    // Clear the due time first so a slow send can't queue the same reminder twice.
    update(r.id, { nextReminderAt: null, emailStatus: "queued" });
    enqueue(SEND_EMAIL_JOB, { requestId: r.id, kind: "reminder" satisfies EmailKind }, { maxAttempts: 4 });
  }
  return due.length;
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

export function unsubscribe(r: TestimonialRequest) {
  if (r.status === "unsubscribed") return r;
  return update(r.id, {
    status: r.status === "responded" ? "responded" : "unsubscribed",
    unsubscribedAt: new Date(),
    nextReminderAt: null,
  });
}

// ------------------------------------------------------------------ receipts

export const THANK_YOU_JOB = "email.thank-you";

/** After a submission: a receipt with the private withdrawal link. */
export function queueThankYou(project: Project, to: string | undefined, withdrawUrl: string) {
  if (!to || !project.thankYouEmail || !emailEnabled()) return false;
  enqueue(THANK_YOU_JOB, { projectId: project.id, to, withdrawUrl }, { maxAttempts: 4 });
  return true;
}

export async function sendThankYou(payload: { projectId: string; to: string; withdrawUrl: string }) {
  const project = getDb().select().from(projects).where(eq(projects.id, payload.projectId)).get();
  if (!project) return;
  await sendMail({
    to: payload.to,
    subject: `Thanks for your testimonial for ${project.name}`,
    text: `Thank you for taking the time to share your experience with ${project.name}. They'll review it before it appears anywhere.

If you change your mind, you can withdraw your testimonial at any time with this private link:
${payload.withdrawUrl}

Keep this email: anyone with the link can withdraw the testimonial.
`,
  });
}
