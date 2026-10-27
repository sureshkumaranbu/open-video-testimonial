import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Customer, Project } from "@/db/schema";
import { upsertCustomer } from "./customers";
import { listForms } from "./forms";
import { parseFormRow } from "./forms/schema";
import { registerPeriodic } from "./jobs";
import { createRequests, withLink } from "./requests";

const { customers, testimonials, feedback, requests, rewardCodes, campaigns } = schema;

/**
 * Customer records (INBOX-12): one row per person per project, kept by
 * customers.ts as testimonials arrive (forms, manual add, CSV and XLSX, review
 * sites), plus an hourly backfill for older rows. Owner-only: nothing here is
 * ever on a public page, and edits never change what a testimonial says.
 */

export const CUSTOMER_PAGE_SIZE = 50;

/** A LIKE pattern that matches `s` literally (with ESCAPE '\'). */
const like = (s: string) => `%${s.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// Spelled out: inside a one-table query Drizzle drops the table name, which a correlated subquery needs.
const testimonialCount = sql<number>`(SELECT count(*) FROM testimonials t WHERE t.customer_id = "customers"."id" AND t.status != 'trashed')`;
const feedbackCount = sql<number>`(SELECT count(*) FROM feedback f WHERE f.customer_id = "customers"."id" AND f.trashed_at IS NULL)`;
// Requests keep the address lower-cased (parseRecipients), and so do customers.
const inviteCount = sql<number>`(SELECT count(*) FROM requests r WHERE r.project_id = "customers"."project_id" AND "customers"."email" IS NOT NULL AND lower(r.email) = "customers"."email")`;

export type CustomerListItem = Pick<Customer, "id" | "name" | "email" | "title" | "company"> & {
  testimonials: number;
  feedback: number;
  invites: number;
  createdAt: string;
};

/** One page of the project's customers, most recent first, searched by name, email or company. */
export function listCustomers(projectId: string, o: { q?: string; page?: number } = {}): { items: CustomerListItem[]; total: number; page: number; pageSize: number } {
  const db = getDb();
  const q = (o.q ?? "").trim().slice(0, 120);
  const where = and(
    eq(customers.projectId, projectId),
    q
      ? sql`(lower(${customers.name}) LIKE ${like(q)} ESCAPE '\\' OR coalesce(${customers.email}, '') LIKE ${like(q)} ESCAPE '\\' OR lower(coalesce(${customers.company}, '')) LIKE ${like(q)} ESCAPE '\\')`
      : undefined,
  );
  const page = Math.max(1, Math.min(o.page ?? 1, 10_000));
  const total = db.select({ n: sql<number>`count(*)` }).from(customers).where(where).get()?.n ?? 0;
  const rows = db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      title: customers.title,
      company: customers.company,
      createdAt: customers.createdAt,
      testimonials: testimonialCount,
      feedback: feedbackCount,
      invites: inviteCount,
    })
    .from(customers)
    .where(where)
    .orderBy(desc(customers.createdAt), asc(customers.id))
    .limit(CUSTOMER_PAGE_SIZE)
    .offset((page - 1) * CUSTOMER_PAGE_SIZE)
    .all();
  return { items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), total, page, pageSize: CUSTOMER_PAGE_SIZE };
}

export function getCustomer(projectId: string, id: string): Customer | null {
  return getDb().select().from(customers).where(and(eq(customers.id, id), eq(customers.projectId, projectId))).get() ?? null;
}

function readSocials(raw: string): Record<string, string> {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Forms whose main question asks for a video only: "Ask for a video" offers these first. */
function videoFormIds(projectId: string) {
  const out = new Set<string>();
  for (const f of listForms(projectId)) {
    const cfg = parseFormRow(f);
    const main = cfg.pages.find((p) => p.type === "question" && p.enabled && p.primary) ?? cfg.pages.find((p) => p.type === "question" && p.enabled);
    if (main && main.type === "question" && main.mode === "video") out.add(f.id);
  }
  return out;
}

/**
 * Everything about one person in this project: their testimonials, private
 * feedback (linked, or sent with their address), invitations and campaign
 * emails (by address), and the reward codes they claimed.
 */
export function customerProfile(project: Pick<Project, "id" | "slug">, id: string) {
  const c = getCustomer(project.id, id);
  if (!c) return null;
  const db = getDb();
  const rows = db
    .select({
      id: testimonials.id,
      status: testimonials.status,
      rating: testimonials.rating,
      headline: testimonials.headline,
      text: testimonials.text,
      hasVideo: sql<number>`${testimonials.videoKey} IS NOT NULL`,
      platform: testimonials.platform,
      source: testimonials.source,
      createdAt: testimonials.createdAt,
    })
    .from(testimonials)
    .where(and(eq(testimonials.projectId, project.id), eq(testimonials.customerId, c.id)))
    .orderBy(desc(testimonials.createdAt))
    .limit(200)
    .all();
  const notes = db
    .select({ id: feedback.id, rating: feedback.rating, text: feedback.text, source: feedback.source, createdAt: feedback.createdAt })
    .from(feedback)
    .where(
      and(
        eq(feedback.projectId, project.id),
        isNull(feedback.trashedAt),
        c.email ? or(eq(feedback.customerId, c.id), sql`lower(${feedback.authorEmail}) = ${c.email}`) : eq(feedback.customerId, c.id),
      ),
    )
    .orderBy(desc(feedback.createdAt))
    .limit(200)
    .all();
  const invites = c.email
    ? db
        .select({ request: requests, campaign: campaigns.name })
        .from(requests)
        .leftJoin(campaigns, eq(campaigns.id, requests.campaignId))
        .where(and(eq(requests.projectId, project.id), sql`lower(${requests.email}) = ${c.email}`))
        .orderBy(desc(requests.createdAt))
        .limit(200)
        .all()
    : [];
  const testimonialIds = rows.map((r) => r.id);
  const feedbackIds = notes.map((n) => n.id);
  const requestIds = invites.map((i) => i.request.id);
  const owned = [
    testimonialIds.length ? inArray(rewardCodes.testimonialId, testimonialIds) : undefined,
    feedbackIds.length ? inArray(rewardCodes.feedbackId, feedbackIds) : undefined,
    requestIds.length ? inArray(rewardCodes.requestId, requestIds) : undefined,
  ].filter((x) => x !== undefined);
  const rewards = owned.length
    ? db
        .select({ id: rewardCodes.id, code: rewardCodes.code, claimedAt: rewardCodes.claimedAt, formId: rewardCodes.formId })
        .from(rewardCodes)
        .where(and(eq(rewardCodes.projectId, project.id), isNotNull(rewardCodes.claimedAt), or(...owned)))
        .orderBy(desc(rewardCodes.claimedAt))
        .all()
    : [];
  const video = videoFormIds(project.id);
  return {
    customer: { ...c, socials: readSocials(c.socials), createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() },
    testimonials: rows.map((r) => ({ ...r, hasVideo: Boolean(r.hasVideo), text: r.text ? r.text.slice(0, 400) : null, createdAt: r.createdAt.toISOString() })),
    feedback: notes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    invites: invites.map(({ request: r, campaign }) => ({
      id: r.id,
      campaignId: r.campaignId,
      campaign,
      status: r.status,
      emailStatus: r.emailStatus,
      sentAt: r.sentAt?.toISOString() ?? null,
      openedAt: r.openedAt?.toISOString() ?? null,
      clickedAt: r.clickedAt?.toISOString() ?? null,
      respondedAt: r.respondedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      link: withLink(project, r).link,
    })),
    rewards: rewards.map((r) => ({ ...r, claimedAt: r.claimedAt?.toISOString() ?? null })),
    forms: listForms(project.id).map((f) => ({ id: f.id, name: f.name, isDefault: f.isDefault, status: f.status, asksForVideo: video.has(f.id) })),
  };
}
export type CustomerProfile = NonNullable<ReturnType<typeof customerProfile>>;

const clean = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);

export const customerPatchSchema = z
  .object({
    name: z.string().trim().min(1, "Add their name").max(120),
    email: z
      .union([z.email("That email address doesn't look right").max(254), z.literal(""), z.null()])
      .transform((v) => (v ? v.toLowerCase() : null)),
    title: clean(120),
    company: clean(120),
    website: z
      .union([z.url({ protocol: /^https?$/, error: "Use a web address that starts with https://" }).max(500), z.literal(""), z.null()])
      .transform((v) => v || null),
  })
  .partial();
export type CustomerPatch = z.infer<typeof customerPatchSchema>;

export class CustomerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Edits the person's own record. Their testimonials keep what they wrote (consent), so nothing else changes. */
export function updateCustomer(projectId: string, id: string, patch: CustomerPatch): Customer {
  const c = getCustomer(projectId, id);
  if (!c) throw new CustomerError(404, "Customer not found");
  const db = getDb();
  if (patch.email && patch.email !== c.email) {
    const taken = db.select({ id: customers.id }).from(customers).where(and(eq(customers.projectId, projectId), eq(customers.email, patch.email))).get();
    if (taken) throw new CustomerError(409, "Another customer in this project already has this email address");
  }
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (!Object.keys(set).length) return c;
  return db.update(customers).set({ ...set, updatedAt: new Date() }).where(eq(customers.id, c.id)).returning().get()!;
}

/**
 * "Invite to a form" and "Ask for a video" from a profile: a personal request
 * link to the chosen form (Requests tab), emailed when `send` is set. The
 * usual rules apply: one open request per address, never to someone who
 * unsubscribed.
 */
export function inviteCustomer(project: Project, id: string, o: { formId: string | null; send: boolean }) {
  const c = getCustomer(project.id, id);
  if (!c) throw new CustomerError(404, "Customer not found");
  if (!c.email) throw new CustomerError(400, "Add their email address first");
  const { created, skipped } = createRequests(project, [{ email: c.email, name: c.name, company: c.company ?? undefined }], { send: o.send, formId: o.formId });
  if (!created.length) {
    throw new CustomerError(409, skipped[0]?.reason === "unsubscribed" ? "They unsubscribed from this project's emails" : "They already have an open invitation. Find it in the Requests tab.");
  }
  return withLink(project, created[0]);
}

// ------------------------------------------------------------------ backfill

export const CUSTOMER_BACKFILL_TASK = "customers.backfill";
const BACKFILL_BATCH = 500;

/**
 * Links testimonials that have no customer yet (rows from before customer
 * records, and ones the API added) to one, by email when there is one.
 * Runs hourly in batches; a no-op once everything is linked. Returns how many it linked.
 */
export function backfillCustomers(limit = BACKFILL_BATCH): number {
  const db = getDb();
  const rows = db
    .select()
    .from(testimonials)
    .where(and(isNull(testimonials.customerId), sql`trim(${testimonials.authorName}) <> ''`))
    .orderBy(asc(testimonials.createdAt), asc(testimonials.id))
    .limit(limit)
    .all();
  let linked = 0;
  for (const t of rows) {
    db.transaction((tx) => {
      const c = upsertCustomer(
        t.projectId,
        { email: t.authorEmail ?? undefined, name: t.authorName, title: t.authorTitle ?? undefined, company: t.authorCompany ?? undefined, website: t.authorWebsite ?? undefined, avatarKey: t.avatarKey ?? undefined },
        tx,
      );
      if (!c) return;
      tx.update(testimonials).set({ customerId: c.id }).where(and(eq(testimonials.id, t.id), isNull(testimonials.customerId))).run();
      linked++;
    });
  }
  return linked;
}

export function registerCustomerJobs(): void {
  registerPeriodic(CUSTOMER_BACKFILL_TASK, 60 * 60 * 1000, () => backfillCustomers());
}
