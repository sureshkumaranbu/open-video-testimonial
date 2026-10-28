import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Campaign, CampaignStatus, Project, TestimonialRequest } from "@/db/schema";
import { DEFAULT_BUTTON_TEXT, DEFAULT_CAMPAIGN_BODY, DEFAULT_CAMPAIGN_SUBJECT, renderCampaignEmail, VARIABLE_NAME } from "./campaign-email";
import { parseCsv } from "./csv";
import { emailEnabled, fromAddress, sendMail } from "./email";
import { env } from "./env";
import { formUrl, getForm } from "./forms";
import {
  campaignEmail,
  inviteToApi,
  parseReminderList,
  queueInvite,
  rewardFormId,
  SAMPLE_CODE,
  unsubscribedAmong,
} from "./requests";
import { poolStats } from "./rewards";

const { campaigns, requests, customers, testimonials } = schema;

/**
 * Email campaigns (M9, REQ-01..07). A campaign has its own wording, sender,
 * reminder schedule and form; its recipients are `requests` rows with its
 * campaign_id, so links, reminders, unsubscribe and "responded" work exactly
 * as on the Requests tab. Nothing is sent while it's a draft or paused.
 * Recipients come from a paste or CSV, the project's customers, one at a time,
 * the API (`POST /api/v1/invites`) or the campaign's incoming webhook.
 */

export class CampaignError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const DAY = 24 * 60 * 60 * 1000;
const MAX_VARIABLES = 20;
const MAX_VARIABLE_CHARS = 500;
/** Rows per import, so one paste can't tie the server up. */
export const MAX_IMPORT_ROWS = 5000;

// ------------------------------------------------------------------ settings

const reminderDays = z
  .array(z.number().int("Reminders are whole days").min(1, "A reminder is at least 1 day after the invitation").max(60, "A reminder is at most 60 days after the invitation"))
  .max(10)
  .transform((days) => [...new Set(days)].sort((a, b) => a - b))
  .refine((days) => days.length <= 3, "Up to three reminders");

export const campaignFields = z.object({
  name: z.string().trim().min(1, "Give the campaign a name").max(120),
  formId: z.string().max(64).nullable(),
  senderName: z.string().trim().max(80),
  replyTo: z.union([z.literal(""), z.email("Enter a valid reply-to address").max(254)]),
  subject: z.string().max(200),
  body: z.string().max(10_000),
  buttonText: z.string().trim().max(60),
  rtl: z.boolean(),
  reminders: reminderDays,
  trackOpens: z.boolean(),
  /** REQ-08: each recipient gets their own code from the form's reward code pool. */
  rewardCodes: z.boolean(),
});
export type CampaignFields = z.infer<typeof campaignFields>;

export const campaignPatch = campaignFields.partial().extend({ status: z.enum(["active", "paused"]).optional() });
export const createCampaignBody = z.object({ name: campaignFields.shape.name, formId: z.string().max(64).nullish() });

/** The wording a preview or test send uses: the saved campaign with the editor's unsaved changes. */
export const draftContent = campaignFields.pick({ subject: true, body: true, buttonText: true, rtl: true, senderName: true, replyTo: true, rewardCodes: true }).partial();

function formOfProject(project: Project, formId: string | null | undefined) {
  if (!formId) return null;
  const form = getForm(formId);
  if (!form || form.projectId !== project.id) throw new CampaignError(404, "Form not found");
  return form;
}

export function listCampaigns(projectId: string) {
  return getDb().select().from(campaigns).where(eq(campaigns.projectId, projectId)).orderBy(desc(campaigns.createdAt)).all();
}

export function getCampaign(id: string) {
  return getDb().select().from(campaigns).where(eq(campaigns.id, id)).get() ?? null;
}

/** A new draft with our default wording and reminders 3 and 7 days later. */
export function createCampaign(project: Project, input: z.infer<typeof createCampaignBody>) {
  const form = formOfProject(project, input.formId);
  const now = new Date();
  return getDb()
    .insert(campaigns)
    .values({
      id: crypto.randomUUID(),
      projectId: project.id,
      formId: form?.id ?? null,
      name: input.name,
      subject: DEFAULT_CAMPAIGN_SUBJECT,
      body: DEFAULT_CAMPAIGN_BODY,
      buttonText: DEFAULT_BUTTON_TEXT,
      reminders: JSON.stringify([3, 7]),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

/** Saves settings and moves between draft, active and paused. */
export function updateCampaign(project: Project, c: Campaign, patch: z.infer<typeof campaignPatch>) {
  const { status, reminders, ...fields } = patch;
  const db = getDb();
  if (fields.formId !== undefined) formOfProject(project, fields.formId);
  const row = db
    .update(campaigns)
    .set({ ...fields, ...(reminders ? { reminders: JSON.stringify(reminders) } : {}), updatedAt: new Date() })
    .where(eq(campaigns.id, c.id))
    .returning()
    .get()!;
  // Recipients still waiting open the new form from now on.
  if (fields.formId !== undefined && fields.formId !== c.formId) {
    db.update(requests).set({ formId: fields.formId }).where(and(eq(requests.campaignId, c.id), eq(requests.status, "waiting"))).run();
  }
  return status && status !== row.status ? setStatus(project, row, status) : row;
}

/**
 * Starting (or resuming) queues an invitation for everyone who hasn't had
 * one; pausing stops new sends and reminders until it's resumed.
 */
function setStatus(project: Project, c: Campaign, status: Exclude<CampaignStatus, "draft">) {
  if (status === "active" && !emailEnabled()) {
    throw new CampaignError(409, "Email isn't set up on this server (SMTP_URL), so a campaign can't send. Set it up, then start the campaign.");
  }
  const row = getDb().update(campaigns).set({ status, updatedAt: new Date() }).where(eq(campaigns.id, c.id)).returning().get()!;
  if (status === "active") queueUnsent(project, row);
  return row;
}

function queueUnsent(project: Project, c: Campaign) {
  const waiting = getDb()
    .select()
    .from(requests)
    .where(and(eq(requests.campaignId, c.id), eq(requests.status, "waiting"), eq(requests.emailStatus, "not_sent")))
    .orderBy(asc(requests.createdAt))
    .all();
  for (const r of waiting) queueInvite(project, r);
  return waiting.length;
}

export function deleteCampaign(id: string) {
  return getDb().delete(campaigns).where(eq(campaigns.id, id)).returning().get() ?? null;
}

// ------------------------------------------------------------------ stats

export type Funnel = {
  recipients: number;
  queued: number;
  sent: number;
  bounced: number;
  failed: number;
  /** Null when the campaign doesn't track opens. Counts anyone who clicked, since images are often off. */
  opened: number | null;
  clicked: number;
  started: number;
  submitted: number;
  declined: number;
  unsubscribed: number;
};

export function funnelOf(rows: TestimonialRequest[], trackOpens: boolean): Funnel {
  const n = (f: (r: TestimonialRequest) => unknown) => rows.filter(f).length;
  return {
    recipients: rows.length,
    queued: n((r) => r.emailStatus === "queued"),
    sent: n((r) => r.sentAt),
    bounced: n((r) => r.emailStatus === "bounced"),
    failed: n((r) => r.emailStatus === "failed"),
    opened: trackOpens ? n((r) => r.openedAt || r.clickedAt) : null,
    clicked: n((r) => r.clickedAt),
    started: n((r) => r.startedAt),
    submitted: n((r) => r.status === "responded"),
    declined: n((r) => r.status === "declined"),
    unsubscribed: n((r) => r.status === "unsubscribed"),
  };
}

/** Each campaign's funnel, from one query. */
export function funnelsFor(projectId: string, list: Campaign[]) {
  const rows = getDb()
    .select()
    .from(requests)
    .where(and(eq(requests.projectId, projectId), isNotNull(requests.campaignId)))
    .all();
  return new Map(list.map((c) => [c.id, funnelOf(rows.filter((r) => r.campaignId === c.id), c.trackOpens)]));
}

/** A campaign as the dashboard sees it: never the webhook token's hash. */
export function campaignToAdmin(c: Campaign, funnel?: Funnel) {
  const { webhookTokenHash, webhookTokenPrefix, reminders, ...rest } = c;
  return {
    ...rest,
    reminders: parseReminderList(reminders),
    webhook: { on: Boolean(webhookTokenHash), prefix: webhookTokenPrefix },
    ...(funnel ? { funnel } : {}),
  };
}
export type AdminCampaign = ReturnType<typeof campaignToAdmin>;

/** REQ-08: the pool a campaign's codes come from, and how many are left (the dashboard warns when it's low or empty). */
export function campaignRewardPool(project: Project, c: Campaign) {
  const formId = rewardFormId(project, c);
  const form = getForm(formId);
  return { formId, formName: form?.name ?? "", ...poolStats(formId) };
}
export type CampaignRewardPool = ReturnType<typeof campaignRewardPool>;

/** A recipient row on the campaign page. */
export function recipientToAdmin(project: Project, r: TestimonialRequest) {
  return { ...inviteToApi(project, r), emailError: r.emailError, nextReminderAt: r.nextReminderAt?.toISOString() ?? null };
}
export type AdminRecipient = ReturnType<typeof recipientToAdmin>;

// ------------------------------------------------------------------ recipients

export type RecipientInput = {
  email: string;
  name?: string | null;
  company?: string | null;
  title?: string | null;
  custom?: Record<string, string>;
};

/** One row of an import: what it said, and the person read from it (or why not). */
export type ImportRow = { line: number; text: string; input?: RecipientInput; error?: string };

export const SKIP_REASONS = ["invalid", "duplicate", "unsubscribed", "responded"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
export type Skipped = { line: number | null; email: string; text: string; reason: SkipReason; detail: string };

const emailSchema = z.email();

/** A CSV header as a template variable name: "Plan name" becomes plan_name. */
export function variableName(header: string) {
  const name = header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return VARIABLE_NAME.test(name) ? name : null;
}

/** Custom variables: valid names, short string values, at most 20. */
export function cleanVariables(vars: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars ?? {})) {
    if (Object.keys(out).length >= MAX_VARIABLES) break;
    if (!VARIABLE_NAME.test(k) || v === null || v === undefined) continue;
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    out[k] = String(v).trim().slice(0, MAX_VARIABLE_CHARS);
  }
  return out;
}

const COLUMNS = {
  email: ["email", "e-mail", "email address"],
  name: ["name", "full name", "full_name"],
  first: ["first name", "first_name", "firstname", "given name"],
  last: ["last name", "last_name", "lastname", "surname", "family name"],
  company: ["company", "organisation", "organization", "company name"],
  title: ["title", "job title", "job_title", "role", "position"],
} as const;

/**
 * Pasted lines or a CSV. With a header row that names an email column,
 * columns are matched by name (name or first + last, email, company, title)
 * and every other column becomes a custom variable; otherwise each line is
 * `name, email, company` or a bare address.
 */
export function parseRecipientTable(input: string): ImportRow[] {
  const table = parseCsv(input).filter((r) => r.some((c) => c.trim()));
  if (!table.length) return [];
  const header = table[0].map((h) => h.trim().toLowerCase());
  const find = (names: readonly string[]) => header.findIndex((h) => names.includes(h));
  const emailCol = header.findIndex((h) => (COLUMNS.email as readonly string[]).includes(h) || h.includes("email"));
  const rows: ImportRow[] = [];
  if (emailCol >= 0) {
    const idx = { name: find(COLUMNS.name), first: find(COLUMNS.first), last: find(COLUMNS.last), company: find(COLUMNS.company), title: find(COLUMNS.title) };
    const known = new Set([emailCol, ...Object.values(idx)].filter((i) => i >= 0));
    const extras = header.map((h, i) => (known.has(i) ? null : variableName(h)));
    table.slice(1).forEach((cells, i) => {
      const cell = (j: number) => (j >= 0 ? (cells[j] ?? "").trim() : "");
      const text = cells.map((c) => c.trim()).join(", ");
      const email = cell(emailCol).toLowerCase();
      const line = i + 2;
      if (!emailSchema.safeParse(email).success) return rows.push({ line, text, error: email ? "Not a valid email address" : "No email address" });
      const name = cell(idx.name) || [cell(idx.first), cell(idx.last)].filter(Boolean).join(" ");
      const custom: Record<string, string> = {};
      extras.forEach((key, j) => {
        if (key && cell(j)) custom[key] = cell(j);
      });
      rows.push({ line, text, input: { email, name: name.slice(0, 120) || null, company: cell(idx.company).slice(0, 120) || null, title: cell(idx.title).slice(0, 120) || null, custom: cleanVariables(custom) } });
    });
    return rows;
  }
  table.forEach((r, i) => {
    const cells = r.map((c) => c.trim());
    const text = cells.join(", ");
    const single = cells.filter(Boolean).length === 1;
    const email = (single ? cells.find(Boolean)! : (cells[1] ?? "")).toLowerCase();
    if (!emailSchema.safeParse(email).success) return rows.push({ line: i + 1, text, error: "Not a valid email address" });
    rows.push({
      line: i + 1,
      text,
      input: { email, name: single ? null : (cells[0] ?? "").slice(0, 120) || null, company: single ? null : (cells[2] ?? "").slice(0, 120) || null },
    });
  });
  return rows;
}

/** The project's customers that have an email address, for "Pick from customers". */
export function customersWithEmail(projectId: string) {
  return getDb()
    .select({ id: customers.id, name: customers.name, email: customers.email, company: customers.company, title: customers.title })
    .from(customers)
    .where(and(eq(customers.projectId, projectId), isNotNull(customers.email)))
    .orderBy(asc(customers.name))
    .all() as { id: string; name: string; email: string; company: string | null; title: string | null }[];
}

export function customerRows(projectId: string, ids: string[]): ImportRow[] {
  if (!ids.length) return [];
  const found = getDb()
    .select()
    .from(customers)
    .where(and(eq(customers.projectId, projectId), inArray(customers.id, ids), isNotNull(customers.email)))
    .all();
  return found.map((c) => ({ line: 0, text: `${c.name} <${c.email}>`, input: { email: c.email!.toLowerCase(), name: c.name, company: c.company, title: c.title } }));
}

/** Addresses in `emails` that already responded in this project (a request or a testimonial with that email). */
function respondedAmong(projectId: string, emails: string[]) {
  if (!emails.length) return new Set<string>();
  const db = getDb();
  const viaRequests = db
    .select({ email: requests.email })
    .from(requests)
    .where(and(eq(requests.projectId, projectId), eq(requests.status, "responded"), inArray(requests.email, emails)))
    .all()
    .map((r) => r.email);
  const lower = sql<string>`lower(${testimonials.authorEmail})`;
  const viaTestimonials = db
    .select({ email: lower })
    .from(testimonials)
    .where(and(eq(testimonials.projectId, projectId), inArray(lower, emails)))
    .all()
    .map((r) => r.email);
  return new Set([...viaRequests, ...viaTestimonials]);
}

const REASON_DETAIL: Record<SkipReason, string> = {
  invalid: "Not a valid email address",
  duplicate: "Already in this campaign",
  unsubscribed: "Unsubscribed from this project's emails",
  responded: "Already sent a testimonial",
};

/**
 * Adds people to a campaign. Skips (and reports, row by row) bad addresses,
 * anyone already in the campaign or twice in this import, addresses that
 * unsubscribed from the project, and people who already responded. On an
 * active campaign the invitations are queued at once.
 */
export function addRecipients(project: Project, c: Campaign, rows: ImportRow[], o: { delayMs?: number } = {}) {
  const db = getDb();
  const valid = rows.filter((r) => r.input);
  const emails = [...new Set(valid.map((r) => r.input!.email))];
  const inCampaign = new Set(
    emails.length
      ? db.select({ email: requests.email }).from(requests).where(and(eq(requests.campaignId, c.id), inArray(requests.email, emails))).all().map((r) => r.email)
      : [],
  );
  const unsubscribed = unsubscribedAmong(project.id, emails);
  const responded = respondedAmong(project.id, emails);
  const skipped: Skipped[] = [];
  const created: TestimonialRequest[] = [];
  const skip = (row: ImportRow, reason: SkipReason, detail = REASON_DETAIL[reason]) =>
    skipped.push({ line: row.line || null, email: row.input?.email ?? "", text: row.text, reason, detail });

  db.transaction((tx) => {
    for (const row of rows) {
      if (!row.input) {
        skip(row, "invalid", row.error);
        continue;
      }
      const p = row.input;
      if (inCampaign.has(p.email)) {
        skip(row, "duplicate");
        continue;
      }
      if (unsubscribed.has(p.email)) {
        skip(row, "unsubscribed");
        continue;
      }
      if (responded.has(p.email)) {
        skip(row, "responded");
        continue;
      }
      inCampaign.add(p.email);
      created.push(
        tx
          .insert(requests)
          .values({
            id: crypto.randomUUID(),
            projectId: project.id,
            campaignId: c.id,
            email: p.email,
            name: p.name?.trim().slice(0, 120) || null,
            company: p.company?.trim().slice(0, 120) || null,
            title: p.title?.trim().slice(0, 120) || null,
            custom: JSON.stringify(cleanVariables(p.custom)),
            formId: c.formId,
            createdAt: new Date(),
          })
          .returning()
          .get(),
      );
    }
  });
  const queued = c.status === "active" && emailEnabled() ? created.map((r) => queueInvite(project, r, o)) : created;
  return { created: queued, skipped };
}

const recipientPerson = z.object({
  email: z.string().trim().max(254),
  name: z.string().trim().max(120).optional(),
  company: z.string().trim().max(120).optional(),
  title: z.string().trim().max(120).optional(),
});

/** REQ-02: how people are added, from the dashboard and the API alike. */
export const recipientsBody = z.discriminatedUnion("source", [
  /** Pasted lines, or a CSV file's text. */
  z.object({ source: z.literal("paste"), text: z.string().min(1, "Paste some people or load a CSV file").max(2_000_000) }),
  z.object({ source: z.literal("customers"), ids: z.array(z.string().max(64)).min(1, "Pick at least one customer").max(MAX_IMPORT_ROWS) }),
  z.object({ source: z.literal("manual"), person: recipientPerson }),
]);
export type RecipientsBody = z.infer<typeof recipientsBody>;

/** The body's people as import rows. */
export function recipientRows(project: Project, d: RecipientsBody): ImportRow[] {
  return importRows(
    project,
    d.source === "paste" ? { kind: "paste", text: d.text } : d.source === "customers" ? { kind: "customers", ids: d.ids } : { kind: "manual", person: d.person },
  );
}

/** Reads one way of adding people (a paste or CSV, picked customers, one person) into import rows. */
export function importRows(project: Project, source: { kind: "paste"; text: string } | { kind: "customers"; ids: string[] } | { kind: "manual"; person: RecipientInput }): ImportRow[] {
  if (source.kind === "paste") return parseRecipientTable(source.text);
  if (source.kind === "customers") return customerRows(project.id, source.ids);
  const email = source.person.email.trim().toLowerCase();
  const text = [source.person.name, email].filter(Boolean).join(" ");
  if (!emailSchema.safeParse(email).success) return [{ line: 0, text, error: "Not a valid email address" }];
  return [{ line: 0, text, input: { ...source.person, email } }];
}

// ------------------------------------------------------------------ auto-collect (REQ-07)

export const inviteInput = z.object({
  email: z.email("Enter a valid email address").max(254),
  name: z.string().trim().max(120).optional(),
  company: z.string().trim().max(120).optional(),
  title: z.string().trim().max(120).optional(),
  variables: z.record(z.string().max(40), z.union([z.string().max(MAX_VARIABLE_CHARS), z.number(), z.boolean(), z.null()])).optional(),
  /** Send this many days later (0 sends now). */
  delayDays: z.number().min(0).max(365).optional(),
});
export type InviteInput = z.infer<typeof inviteInput>;

/**
 * One invite from the API or the incoming webhook. The campaign must be
 * active. A person already in the campaign, unsubscribed or who already
 * responded is skipped (no second email) and the reason is returned.
 */
export function createInvite(project: Project, c: Campaign, input: InviteInput) {
  if (c.status !== "active") throw new CampaignError(409, `This campaign is ${c.status === "draft" ? "a draft" : "paused"}, so it isn't taking invites. Start it in the dashboard first.`);
  if (!emailEnabled()) throw new CampaignError(409, "Email isn't set up on this server (SMTP_URL)");
  const email = input.email.trim().toLowerCase();
  const row: ImportRow = {
    line: 0,
    text: email,
    input: { email, name: input.name, company: input.company, title: input.title, custom: cleanVariables(input.variables ?? undefined) },
  };
  const { created, skipped } = addRecipients(project, c, [row], { delayMs: input.delayDays ? input.delayDays * DAY : 0 });
  if (created[0]) return { invite: created[0], skipped: null };
  const existing = getDb().select().from(requests).where(and(eq(requests.campaignId, c.id), eq(requests.email, email))).get() ?? null;
  return { invite: existing, skipped: skipped[0]?.reason ?? "duplicate" };
}

const TOKEN = /^cwh_[A-Za-z0-9_-]{32}$/;
const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export function webhookUrl(token: string) {
  return `${env.publicUrl}/api/hooks/campaigns/${token}`;
}

/**
 * A new incoming webhook URL for the campaign; the old one stops working.
 * The token is shown once: only its SHA-256 is stored.
 */
export function regenerateWebhook(c: Campaign) {
  const token = `cwh_${crypto.randomBytes(24).toString("base64url")}`;
  getDb()
    .update(campaigns)
    .set({ webhookTokenHash: hashToken(token), webhookTokenPrefix: token.slice(0, 10), updatedAt: new Date() })
    .where(eq(campaigns.id, c.id))
    .run();
  return { token, url: webhookUrl(token) };
}

export function disableWebhook(c: Campaign) {
  return getDb().update(campaigns).set({ webhookTokenHash: null, webhookTokenPrefix: null, updatedAt: new Date() }).where(eq(campaigns.id, c.id)).returning().get();
}

export function findCampaignByWebhookToken(token: string) {
  if (!TOKEN.test(token)) return null;
  return getDb().select().from(campaigns).where(eq(campaigns.webhookTokenHash, hashToken(token))).get() ?? null;
}

// ------------------------------------------------------------------ preview and test (REQ-03, REQ-06)

const SAMPLE = { name: "Sam Sample", company: "Sample Co", title: "Head of Operations" };

function withDraft(c: Campaign, draft: z.infer<typeof draftContent>) {
  return { ...c, ...Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== undefined)) } as Campaign;
}

/**
 * The email as a recipient gets it. With a recipient, it's exactly their mail
 * (minus the open pixel, so previewing never counts as an open); without one,
 * a sample person and links that lead to the plain form.
 */
export function previewCampaign(project: Project, c: Campaign, draft: z.infer<typeof draftContent>, o: { recipient?: TestimonialRequest | null; to?: string } = {}) {
  const campaign = withDraft(c, draft);
  const mail = o.recipient
    ? campaignEmail(project, campaign, o.recipient, "invite", { preview: true })
    : renderCampaignEmail({
        projectName: project.name,
        accentColor: project.accentColor,
        content: campaign,
        recipient: { ...SAMPLE, email: o.to ?? "sam@example.com", custom: {}, rewardCode: campaign.rewardCodes ? SAMPLE_CODE : undefined },
        links: {
          link: `${env.publicUrl}${(() => {
            const form = c.formId ? getForm(c.formId) : null;
            return form && form.projectId === project.id ? formUrl(project, form) : `/c/${project.slug}`;
          })()}`,
          decline: `${env.publicUrl}/d/test`,
          unsubscribe: `${env.publicUrl}/u/test`,
          oneClick: `${env.publicUrl}/api/unsubscribe/test`,
          open: null,
        },
        kind: "invite",
      });
  const from = mail.fromName ? `${mail.fromName} <${fromAddress()}>` : env.smtpFrom;
  return { ...mail, from };
}

/** "Send a test to me": the sample email, marked as a test, to the signed-in member. */
export async function sendCampaignTest(project: Project, c: Campaign, draft: z.infer<typeof draftContent>, to: string) {
  const mail = previewCampaign(project, c, draft, { to });
  const sent = await sendMail({ ...mail, to, subject: `[Test] ${mail.subject}` });
  return { mail, sent };
}
