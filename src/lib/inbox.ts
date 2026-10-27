import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Testimonial, TestimonialStatus } from "@/db/schema";
import { ConsentWithdrawnError, deleteTestimonial, getTestimonial, NoPublicConsentError, updateTestimonial, type TestimonialWithTags } from "./testimonials";
import { embeddingsEnabled, ProviderError, rankBySimilarity } from "./embeddings";
import { withDuplicates } from "./merge";
import { matchesSearch, toFtsQuery } from "./search";
import { restoreTestimonial, trashTestimonial } from "./trash";
import { translationEnabled } from "./translate";
import { queueTranslations } from "./translations";
import { DEFAULT_PREFS, inboxPrefsSchema, MAX_BULK, type InboxMethod, type InboxPrefs, type InboxQuery, type InboxSort, type InboxTab } from "./inbox-query";

const { testimonials, testimonialTags, tags, answers, testimonialImages, feedback, forms, memberPrefs } = schema;

/**
 * Inbox v2 (INBOX-01..06): one server-side query for the dashboard's list,
 * with every filter, the sort and the page in a URL-safe shape, so a view can
 * be shared by copying the address. Owner-only: rows include private fields.
 */

export * from "./inbox-query";

const TAB_STATUS: Partial<Record<InboxTab, TestimonialStatus>> = {
  pending: "pending",
  approved: "approved",
  hidden: "hidden",
  rejected: "rejected",
  trash: "trashed",
};

const METHOD_SQL: Record<InboxMethod, SQL> = {
  form: sql`${testimonials.source} = 'form'`,
  manual: sql`${testimonials.source} = 'manual'`,
  csv: sql`${testimonials.source} LIKE 'import:%'`,
  platform: sql`${testimonials.source} LIKE 'importer:%'`,
  api: sql`${testimonials.source} = 'api'`,
};

const hasAnswerVideo = sql`EXISTS (SELECT 1 FROM answers a WHERE a.testimonial_id = ${testimonials.id} AND a.video_key IS NOT NULL)`;
const hasImage = sql`EXISTS (SELECT 1 FROM testimonial_images i WHERE i.testimonial_id = ${testimonials.id})`;

const dayStart = (d: string) => new Date(`${d}T00:00:00.000Z`);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every condition of the view except the tab, so the tab counts can reuse
 * them. With `ranked` (smart search, INBOX-14) the keyword search is replaced
 * by "one of these ids".
 */
function filterConditions(projectId: string, q: InboxQuery, ranked?: string[]): SQL[] {
  const c: SQL[] = [eq(testimonials.projectId, projectId)];
  const fts = ranked ? null : toFtsQuery(q.q);
  if (ranked) c.push(inArray(testimonials.id, ranked));
  if (fts) c.push(matchesSearch(projectId, fts));
  if (q.rating.length) {
    const stars = q.rating.filter((r) => r > 0);
    const parts: SQL[] = [];
    if (stars.length) parts.push(inArray(testimonials.rating, stars));
    if (q.rating.includes(0)) parts.push(isNull(testimonials.rating));
    c.push(parts.length === 1 ? parts[0] : sql`(${sql.join(parts, sql` OR `)})`);
  }
  if (q.tags.length) {
    const tagged = sql`SELECT tt.testimonial_id FROM testimonial_tags tt JOIN tags g ON g.id = tt.tag_id
      WHERE g.project_id = ${projectId} AND g.name IN (${sql.join(q.tags.map((t) => sql`${t}`), sql`, `)})`;
    c.push(
      q.tagMode === "all" && q.tags.length > 1
        ? sql`${testimonials.id} IN (${tagged} GROUP BY tt.testimonial_id HAVING count(DISTINCT g.name) = ${q.tags.length})`
        : sql`${testimonials.id} IN (${tagged})`,
    );
  }
  if (q.formId) c.push(eq(testimonials.formId, q.formId));
  if (q.type === "video") c.push(sql`(${testimonials.videoKey} IS NOT NULL OR ${hasAnswerVideo})`);
  if (q.type === "image") c.push(hasImage);
  if (q.type === "text") c.push(sql`(${testimonials.videoKey} IS NULL AND NOT ${hasAnswerVideo} AND NOT ${hasImage})`);
  if (q.platform.length) c.push(inArray(testimonials.platform, q.platform));
  if (q.method.length) c.push(sql`(${sql.join(q.method.map((m) => METHOD_SQL[m]), sql` OR `)})`);
  if (q.language) c.push(sql`lower(${testimonials.language}) = ${q.language.toLowerCase()}`);
  if (q.hasAvatar) c.push(isNotNull(testimonials.avatarKey));
  if (q.hasLogo) c.push(isNotNull(testimonials.companyLogoKey));
  if (q.hasImages) c.push(hasImage);
  if (q.dupes) c.push(inArray(testimonials.id, withDuplicates(projectId)));
  if (q.scope) c.push(sql`EXISTS (SELECT 1 FROM json_each(${testimonials.consentScopes}) WHERE value = ${q.scope})`);
  if (q.wordsMin != null) c.push(sql`coalesce(${testimonials.wordCount}, 0) >= ${q.wordsMin}`);
  if (q.wordsMax != null) c.push(sql`coalesce(${testimonials.wordCount}, 0) <= ${q.wordsMax}`);
  if (q.from) c.push(sql`${testimonials.createdAt} >= ${dayStart(q.from).getTime()}`);
  if (q.to) c.push(sql`${testimonials.createdAt} < ${dayStart(q.to).getTime() + DAY_MS}`);
  return c;
}

function tabCondition(tab: InboxTab): SQL | null {
  const status = TAB_STATUS[tab];
  if (status) return eq(testimonials.status, status);
  // All is everything but the trash; Feedback lists another table.
  if (tab === "all") return ne(testimonials.status, "trashed");
  return null;
}

function orderBy(q: InboxQuery): SQL[] {
  const d = q.dir === "asc" ? asc : desc;
  const col: Record<InboxSort, SQL[]> = {
    created: [d(testimonials.createdAt)],
    posted: [d(sql`coalesce(${testimonials.sourceDate}, ${testimonials.createdAt})`)],
    // Unrated ones last either way.
    rating: [sql`${testimonials.rating} IS NULL`, d(testimonials.rating)],
    name: [d(sql`${testimonials.authorName} COLLATE NOCASE`)],
    words: [d(sql`coalesce(${testimonials.wordCount}, 0)`)],
  };
  return [...col[q.sort], desc(testimonials.createdAt), asc(testimonials.id)];
}

/** The tags of these rows, in one query. */
export function withTags(rows: Testimonial[]): TestimonialWithTags[] {
  if (!rows.length) return [];
  const links = getDb()
    .select({ testimonialId: testimonialTags.testimonialId, name: tags.name })
    .from(testimonialTags)
    .innerJoin(tags, eq(tags.id, testimonialTags.tagId))
    .where(inArray(testimonialTags.testimonialId, rows.map((r) => r.id)))
    .all();
  const byId = new Map<string, string[]>();
  for (const l of links) byId.set(l.testimonialId, [...(byId.get(l.testimonialId) ?? []), l.name]);
  return rows.map((r) => ({ ...r, tags: (byId.get(r.id) ?? []).sort() }));
}

/** A row of the inbox: the testimonial with its tags and what else it carries. */
export type InboxItem = TestimonialWithTags & { answerCount: number; answerVideoCount: number; imageCount: number };

function counts(ids: string[]) {
  const db = getDb();
  const a = new Map<string, { n: number; v: number }>();
  const i = new Map<string, number>();
  if (!ids.length) return { a, i };
  for (const r of db
    .select({ id: answers.testimonialId, n: sql<number>`count(*)`, v: sql<number>`count(${answers.videoKey})` })
    .from(answers)
    .where(inArray(answers.testimonialId, ids))
    .groupBy(answers.testimonialId)
    .all())
    a.set(r.id, { n: r.n, v: r.v });
  for (const r of db
    .select({ id: testimonialImages.testimonialId, n: sql<number>`count(*)` })
    .from(testimonialImages)
    .where(inArray(testimonialImages.testimonialId, ids))
    .groupBy(testimonialImages.testimonialId)
    .all())
    i.set(r.id, r.n);
  return { a, i };
}

/**
 * One page of the view, and how many match in all. The Feedback tab has no
 * testimonials (see listProjectFeedback). With `ranked` (smart search) the
 * rows are those ids, in that order, with every other filter applied.
 */
export function queryTestimonials(projectId: string, q: InboxQuery, ranked?: string[]): { items: InboxItem[]; total: number } {
  const tab = tabCondition(q.tab);
  if (!tab) return { items: [], total: 0 };
  const db = getDb();
  const where = and(...filterConditions(projectId, q, ranked), tab);
  const total = db.select({ n: sql<number>`count(*)` }).from(testimonials).where(where).get()?.n ?? 0;
  let rows: Testimonial[];
  if (ranked) {
    const rank = new Map(ranked.map((id, i) => [id, i]));
    rows = db.select().from(testimonials).where(where).all().sort((a, b) => rank.get(a.id)! - rank.get(b.id)!).slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
  } else {
    rows = db
      .select()
      .from(testimonials)
      .where(where)
      .orderBy(...orderBy(q))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .all();
  }
  const { a, i } = counts(rows.map((r) => r.id));
  const items = withTags(rows).map((t) => ({
    ...t,
    answerCount: a.get(t.id)?.n ?? 0,
    answerVideoCount: a.get(t.id)?.v ?? 0,
    imageCount: i.get(t.id) ?? 0,
  }));
  return { items, total };
}

/**
 * Smart search (INBOX-14): the ids that rank for `q.q` by meaning, among the
 * rows the other filters allow (any tab), best first. `fallback` says why it
 * fell back to keyword search: not set up or turned off, or the provider failed.
 */
export async function smartRanking(projectId: string, q: InboxQuery): Promise<{ ranked: string[] } | { fallback: "off" | "failed" }> {
  if (!embeddingsEnabled()) return { fallback: "off" };
  const candidates = new Set(
    getDb()
      .select({ id: testimonials.id })
      .from(testimonials)
      .where(and(...filterConditions(projectId, { ...q, q: "" })))
      .all()
      .map((r) => r.id),
  );
  try {
    return { ranked: (await rankBySimilarity(projectId, q.q, candidates)).map((r) => r.id) };
  } catch (err) {
    if (err instanceof ProviderError) return { fallback: "failed" };
    throw err;
  }
}

/** Every id the view matches (no paging), in its order, for exports. */
export function matchingIds(projectId: string, q: InboxQuery, limit = 100_000): string[] {
  const tab = tabCondition(q.tab);
  if (!tab) return [];
  return getDb()
    .select({ id: testimonials.id })
    .from(testimonials)
    .where(and(...filterConditions(projectId, q), tab))
    .orderBy(...orderBy(q))
    .limit(limit)
    .all()
    .map((r) => r.id);
}

/** How many each tab would show with the same search and filters. "All" leaves out the trash. */
export function inboxCounts(projectId: string, q: InboxQuery, ranked?: string[]): Record<InboxTab, number> {
  const db = getDb();
  const out: Record<InboxTab, number> = { all: 0, pending: 0, approved: 0, hidden: 0, rejected: 0, feedback: 0, trash: 0 };
  const rows = db
    .select({ status: testimonials.status, n: sql<number>`count(*)` })
    .from(testimonials)
    .where(and(...filterConditions(projectId, q, ranked)))
    .groupBy(testimonials.status)
    .all();
  for (const r of rows) {
    if (r.status === "trashed") out.trash = r.n;
    else {
      out[r.status] = r.n;
      out.all += r.n;
    }
  }
  out.feedback = db
    .select({ n: sql<number>`count(*)` })
    .from(feedback)
    .where(and(eq(feedback.projectId, projectId), isNull(feedback.trashedAt)))
    .get()?.n ?? 0;
  return out;
}

/** The dashboard's stat tiles, for the whole project whatever the view: waiting, live and with video. */
export function inboxStats(projectId: string) {
  const row = getDb()
    .select({
      pending: sql<number>`coalesce(sum(${testimonials.status} = 'pending'), 0)`,
      approved: sql<number>`coalesce(sum(${testimonials.status} = 'approved'), 0)`,
      video: sql<number>`coalesce(sum(${testimonials.status} != 'trashed' AND (${testimonials.videoKey} IS NOT NULL OR ${hasAnswerVideo})), 0)`,
    })
    .from(testimonials)
    .where(eq(testimonials.projectId, projectId))
    .get();
  return { pending: row?.pending ?? 0, approved: row?.approved ?? 0, video: row?.video ?? 0 };
}

/** What the filter panel offers: the tags, forms, platforms and languages this project uses. */
export function inboxFacets(projectId: string) {
  const db = getDb();
  const distinct = (col: typeof testimonials.platform | typeof testimonials.language) =>
    db
      .selectDistinct({ v: col })
      .from(testimonials)
      .where(and(eq(testimonials.projectId, projectId), isNotNull(col)))
      .orderBy(col)
      .all()
      .map((r) => r.v as string);
  return {
    tags: db.select({ name: tags.name }).from(tags).where(eq(tags.projectId, projectId)).orderBy(tags.name).all().map((t) => t.name),
    forms: db.select({ id: forms.id, name: forms.name }).from(forms).where(eq(forms.projectId, projectId)).orderBy(desc(forms.isDefault), forms.name).all(),
    platforms: distinct(testimonials.platform),
    languages: distinct(testimonials.language),
  };
}
export type InboxFacets = ReturnType<typeof inboxFacets>;

// ------------------------------------------------------------- feedback

/** The Feedback tab: private answers that never become testimonials, newest first. */
export function listProjectFeedback(projectId: string, o: { page?: number; pageSize?: number } = {}) {
  const db = getDb();
  const pageSize = o.pageSize ?? 25;
  const page = Math.max(1, o.page ?? 1);
  const where = and(eq(feedback.projectId, projectId), isNull(feedback.trashedAt));
  const total = db.select({ n: sql<number>`count(*)` }).from(feedback).where(where).get()?.n ?? 0;
  const items = db
    .select()
    .from(feedback)
    .where(where)
    .orderBy(desc(feedback.createdAt), asc(feedback.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();
  return { items, total };
}

/** Deletes feedback for good. Ids from another project are ignored. Returns how many. */
export function deleteProjectFeedback(projectId: string, ids: string[]): number {
  if (!ids.length) return 0;
  return getDb()
    .delete(feedback)
    .where(and(eq(feedback.projectId, projectId), inArray(feedback.id, ids)))
    .run().changes;
}

// ----------------------------------------------------------------- bulk

export const BULK_ACTIONS = ["approve", "hide", "reject", "pending", "tag", "untag", "trash", "restore", "delete", "translate"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export class BulkError extends Error {}

export type BulkResult = { updated: string[]; skipped: { id: string; reason: string }[] };

const STATUS_OF: Partial<Record<BulkAction, TestimonialStatus>> = {
  approve: "approved",
  hide: "hidden",
  reject: "rejected",
  pending: "pending",
};

const ALREADY: Record<TestimonialStatus, string> = {
  approved: "Already approved",
  hidden: "Already hidden",
  rejected: "Already rejected",
  pending: "Already pending",
  trashed: "Already in the trash",
};

/**
 * One action on many testimonials (INBOX-06), in one request. Ownership is
 * checked for all ids in one query; then each row goes through the same path
 * as a single edit (updateTestimonial, the trash), one after another, so each
 * gets its own history entry and webhook and one refusal doesn't undo the
 * rest. Rows that can't take the action are skipped with the reason.
 */
export async function bulkUpdate(
  projectId: string,
  ids: string[],
  action: BulkAction,
  o: { by?: string; tags?: string[]; langs?: string[] } = {},
): Promise<BulkResult> {
  const unique = [...new Set(ids)];
  if (!unique.length) throw new BulkError("Select at least one testimonial");
  if (unique.length > MAX_BULK) throw new BulkError(`Select at most ${MAX_BULK} testimonials at a time`);
  const names = [...new Set((o.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if ((action === "tag" || action === "untag") && !names.length) throw new BulkError("Name at least one tag");
  if (action === "translate") {
    if (!translationEnabled()) throw new BulkError("Translation isn't set up on this server (TRANSLATE_PROVIDER)");
    if (!o.langs?.length) throw new BulkError("Choose at least one language");
  }

  const owned = new Map(
    getDb()
      .select({ id: testimonials.id, status: testimonials.status, withdrawnAt: testimonials.withdrawnAt, consentPublic: testimonials.consentPublic })
      .from(testimonials)
      .where(and(eq(testimonials.projectId, projectId), inArray(testimonials.id, unique)))
      .all()
      .map((r) => [r.id, r]),
  );
  const result: BulkResult = { updated: [], skipped: [] };
  const skip = (id: string, reason: string) => result.skipped.push({ id, reason });

  for (const id of unique) {
    const row = owned.get(id);
    if (!row) {
      skip(id, "Not a testimonial in this project");
      continue;
    }
    const status = STATUS_OF[action];
    try {
      if (status) {
        if (row.status === "trashed") skip(id, "In the trash. Restore it first.");
        else if (row.status === status) skip(id, ALREADY[status]);
        else if (row.withdrawnAt && status !== "rejected") skip(id, "The author withdrew consent, so it can only stay rejected");
        else if (status === "approved" && !row.consentPublic) skip(id, "The author asked to keep it private");
        else {
          updateTestimonial(id, { status }, { by: o.by });
          result.updated.push(id);
        }
      } else if (action === "tag" || action === "untag") {
        const current = getTestimonial(id)?.tags ?? [];
        const next = action === "tag" ? [...new Set([...current, ...names])] : current.filter((t) => !names.includes(t));
        if (next.length > 20) skip(id, "A testimonial can have at most 20 tags");
        else if (next.length === current.length && next.every((t) => current.includes(t))) {
          skip(id, action === "tag" ? "Already has these tags" : "Doesn't have these tags");
        } else {
          updateTestimonial(id, { tags: next }, { by: o.by });
          result.updated.push(id);
        }
      } else if (action === "trash") {
        if (row.status === "trashed") skip(id, ALREADY.trashed);
        else {
          trashTestimonial(id, { by: o.by });
          result.updated.push(id);
        }
      } else if (action === "restore") {
        if (row.status !== "trashed") skip(id, "Not in the trash");
        else {
          restoreTestimonial(id, { by: o.by });
          result.updated.push(id);
        }
      } else if (action === "translate") {
        // INBOX-06/13: queued, one job per testimonial; each translation gets its own history entry.
        if (row.status === "trashed") skip(id, "In the trash. Restore it first.");
        else if (queueTranslations(id, o.langs ?? [], { by: o.by })) result.updated.push(id);
        else skip(id, "Nothing to translate into");
      } else if (action === "delete") {
        // Deleting for good is offered only from the trash (D6).
        if (row.status !== "trashed") skip(id, "Only testimonials in the trash can be deleted for good");
        else if (await deleteTestimonial(id)) result.updated.push(id);
        else skip(id, "Already deleted");
      }
    } catch (err) {
      if (err instanceof ConsentWithdrawnError || err instanceof NoPublicConsentError) skip(id, err.message);
      else throw err;
    }
  }
  return result;
}

// ---------------------------------------------------------------- prefs

const normEmail = (email: string) => email.trim().toLowerCase();

/** The person's remembered inbox view, sort and page size. */
export function getInboxPrefs(email: string | null | undefined): InboxPrefs {
  if (!email) return DEFAULT_PREFS;
  const row = getDb().select({ ui: memberPrefs.ui }).from(memberPrefs).where(eq(memberPrefs.email, normEmail(email))).get();
  let stored: unknown = {};
  try {
    stored = JSON.parse(row?.ui ?? "{}");
  } catch {
    stored = {};
  }
  const parsed = inboxPrefsSchema.safeParse(stored);
  // A bad stored value (an older format, say) is dropped field by field.
  if (parsed.success) return { ...DEFAULT_PREFS, ...parsed.data };
  const out = { ...DEFAULT_PREFS };
  for (const [k, v] of Object.entries(stored as object)) {
    const one = inboxPrefsSchema.safeParse({ [k]: v });
    if (one.success) Object.assign(out, one.data);
  }
  return out;
}

/** Saves part of the inbox prefs, keeping the rest (and the notification prefs) as they are. */
export function saveInboxPrefs(email: string, patch: Partial<InboxPrefs>): InboxPrefs {
  const db = getDb();
  const key = normEmail(email);
  const row = db.select({ ui: memberPrefs.ui }).from(memberPrefs).where(eq(memberPrefs.email, key)).get();
  let ui: Record<string, unknown> = {};
  try {
    const v: unknown = JSON.parse(row?.ui ?? "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) ui = v as Record<string, unknown>;
  } catch {
    ui = {};
  }
  const next = JSON.stringify({ ...ui, ...patch });
  const now = new Date();
  db.insert(memberPrefs)
    .values({ email: key, ui: next, updatedAt: now })
    .onConflictDoUpdate({ target: memberPrefs.email, set: { ui: next, updatedAt: now } })
    .run();
  return getInboxPrefs(key);
}
