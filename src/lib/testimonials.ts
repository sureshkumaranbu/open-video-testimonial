import crypto from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/db";
import type {
  Approver,
  DatePrecision,
  HistoryActor,
  Project,
  Testimonial,
  TestimonialStatus,
  WebhookEvent,
} from "@/db/schema";
import { CONSENTED_FIELDS, logConsentEvent } from "./consent";
import { countWords } from "./dates";
import { applyLegacyPatch, ensureDefaultForm } from "./forms";
import type { LegacyFormPatch } from "./forms/defaults";
import { DEFAULT_QUESTIONS, DEFAULT_THANK_YOU, LEGACY_FORM_FIELDS, resolveQuestions } from "./forms/legacy";
import { reanchorHighlights } from "./highlights";
import { actorForSource, historyActor, recordHistory } from "./history";
import { mediaUrl, MIME_BY_EXT, removeFiles } from "./storage";
import type { Brand } from "./validation";
import { emitTestimonialEvent } from "./webhooks";

const { projects, testimonials, tags, testimonialTags, answers, testimonialImages } = schema;

export const DEFAULT_PROMPT = "How has our product helped you? We'd love to hear your story.";
export { DEFAULT_QUESTIONS, DEFAULT_THANK_YOU };

/** The project's prompts, one per line, falling back to the defaults. */
export function projectQuestions(project: Pick<Project, "questions">) {
  return resolveQuestions(project);
}

// ---------------------------------------------------------------- projects

export function listProjects() {
  return getDb().select().from(projects).orderBy(desc(projects.createdAt)).all();
}

export function getProjectBySlug(slug: string) {
  return getDb().select().from(projects).where(eq(projects.slug, slug)).get() ?? null;
}

export function getProjectById(id: string) {
  return getDb().select().from(projects).where(eq(projects.id, id)).get() ?? null;
}

export function createProject(input: {
  name: string;
  slug: string;
  prompt?: string;
  thankYouMessage?: string;
  accentColor?: string;
  allowVideo?: boolean;
  allowText?: boolean;
  questions?: string;
  maxVideoSeconds?: number;
  consentText?: string;
  inviteSubject?: string;
  inviteMessage?: string;
  reminderDays?: string;
  thankYouEmail?: boolean;
  autoApprove?: boolean;
  autoApproveMinRating?: number;
  autoApproveVideo?: boolean;
}): Project {
  return getDb().transaction((tx) => {
    const project = tx
      .insert(projects)
      .values({
        id: crypto.randomUUID(),
        name: input.name,
        slug: input.slug,
        prompt: input.prompt ?? DEFAULT_PROMPT,
        thankYouMessage: input.thankYouMessage ?? DEFAULT_THANK_YOU,
        accentColor: input.accentColor,
        allowVideo: input.allowVideo,
        allowText: input.allowText,
        questions: input.questions ?? DEFAULT_QUESTIONS.join("\n"),
        maxVideoSeconds: input.maxVideoSeconds,
        consentText: input.consentText,
        inviteSubject: input.inviteSubject,
        inviteMessage: input.inviteMessage,
        reminderDays: input.reminderDays,
        thankYouEmail: input.thankYouEmail,
        autoApprove: input.autoApprove,
        autoApproveMinRating: input.autoApproveMinRating,
        autoApproveVideo: input.autoApproveVideo,
        autoApproveSince: input.autoApprove ? new Date() : null,
      })
      .returning()
      .get();
    // The classic default form, filled in from these settings (§2.4).
    ensureDefaultForm(project, tx);
    return project;
  });
}

export type ProjectPatch = Partial<
  Pick<
    Project,
    | "name"
    | "prompt"
    | "thankYouMessage"
    | "accentColor"
    | "allowVideo"
    | "allowText"
    | "questions"
    | "maxVideoSeconds"
    | "consentText"
    | "inviteSubject"
    | "inviteMessage"
    | "reminderDays"
    | "thankYouEmail"
    | "autoApprove"
    | "autoApproveMinRating"
    | "autoApproveVideo"
    | "website"
    | "businessType"
  >
> & { brand?: Brand };

/**
 * Saves project settings. The form fields among them (prompt, questions,
 * modes, consent wording, thank-you, accent colour, auto-approve) mirror the
 * default form (D2): applyLegacyPatch writes them to that form (filling it in
 * first if migration 0009 left it at config_version 0) and the columns follow
 * it, in one transaction with the other fields. The form keeps auto-approve's
 * start: it applies from the moment it's turned on, never to what's already
 * waiting.
 */
export function updateProject(id: string, patch: ProjectPatch) {
  const db = getDb();
  const existing = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!existing) return null;
  const { brand, ...rest } = patch;
  const columns: Partial<Project> = Object.fromEntries(
    Object.entries({ ...rest, ...(brand === undefined ? {} : { brand: JSON.stringify(brand) }) }).filter(
      ([, v]) => v !== undefined,
    ),
  );
  if (!Object.keys(columns).length) return existing;
  const isFormField = (k: string) => (LEGACY_FORM_FIELDS as readonly string[]).includes(k);
  const legacy: LegacyFormPatch = Object.fromEntries(Object.entries(columns).filter(([k]) => isFormField(k)));
  const other: Partial<Project> = Object.fromEntries(Object.entries(columns).filter(([k]) => !isFormField(k)));
  return db.transaction((tx) => {
    const saved = applyLegacyPatch(existing, legacy, tx);
    if (!Object.keys(other).length) return saved;
    return tx.update(projects).set(other).where(eq(projects.id, id)).returning().get() ?? null;
  });
}

// ------------------------------------------------------------ testimonials

export interface NewTestimonial {
  name: string;
  email?: string;
  title?: string;
  company?: string;
  rating?: number;
  text?: string;
  avatarKey?: string;
  videoKey?: string;
  videoMime?: string;
  requestId?: string;
  // Phase 1
  formId?: string | null;
  customerId?: string | null;
  headline?: string;
  /** The author's (or their company's) site. Not `website`: that's the form's honeypot (D5). */
  authorWebsite?: string;
  authorPhone?: string;
  authorSocials?: Record<string, string>;
  companyLogoKey?: string;
  /** Where the review was first posted (google, trustpilot…); `source` says how it arrived. */
  platform?: string;
  sourceUrl?: string;
  sourceReviewId?: string;
  sourceDate?: Date;
  datePrecision?: DatePrecision;
  importedAt?: Date;
  language?: string;
  primaryQuestion?: string;
  customFields?: Record<string, unknown>;
  hiddenFields?: Record<string, string>;
  /** false when the author chose to keep it private (D11). */
  consentPublic?: boolean;
}

export function createTestimonial(
  projectId: string,
  input: NewTestimonial,
  /** `by` is the signed-in person adding it, for the history. */
  opts: { source?: string; createdAt?: Date; by?: string } = {},
): Testimonial {
  const now = opts.createdAt ?? new Date();
  const source = opts.source ?? "form";
  return getDb().transaction((tx) => {
    const row = tx
      .insert(testimonials)
      .values({
        id: crypto.randomUUID(),
        projectId,
        status: "pending",
        authorName: input.name,
        authorEmail: input.email ?? null,
        authorTitle: input.title ?? null,
        authorCompany: input.company ?? null,
        rating: input.rating ?? null,
        text: input.text ?? null,
        avatarKey: input.avatarKey ?? null,
        videoKey: input.videoKey ?? null,
        videoMime: input.videoMime ?? null,
        videoOriginalKey: input.videoKey ?? null,
        requestId: input.requestId ?? null,
        source,
        consentAt: now,
        createdAt: now,
        updatedAt: now,
        formId: input.formId ?? null,
        customerId: input.customerId ?? null,
        headline: input.headline ?? null,
        authorWebsite: input.authorWebsite ?? null,
        authorPhone: input.authorPhone ?? null,
        authorSocials: JSON.stringify(input.authorSocials ?? {}),
        companyLogoKey: input.companyLogoKey ?? null,
        platform: input.platform ?? null,
        sourceUrl: input.sourceUrl ?? null,
        sourceReviewId: input.sourceReviewId ?? null,
        sourceDate: input.sourceDate ?? null,
        datePrecision: input.datePrecision ?? "day",
        importedAt: input.importedAt ?? null,
        language: input.language ?? null,
        primaryQuestion: input.primaryQuestion ?? null,
        customFields: JSON.stringify(input.customFields ?? {}),
        hiddenFields: JSON.stringify(input.hiddenFields ?? {}),
        consentPublic: input.consentPublic ?? true,
        // Answers to further questions add theirs when they're inserted (answers.ts).
        wordCount: countWords(input.text),
      })
      .returning()
      .get();
    recordHistory(tx, {
      testimonialId: row.id,
      actor: actorForSource(source),
      actorEmail: opts.by,
      action: "created",
      diff: { source: [null, source] },
      at: now,
    });
    return row;
  });
}

export type TestimonialWithTags = Testimonial & { tags: string[] };

function attachTags(rows: Testimonial[]): TestimonialWithTags[] {
  if (rows.length === 0) return [];
  const links = getDb()
    .select({ testimonialId: testimonialTags.testimonialId, name: tags.name })
    .from(testimonialTags)
    .innerJoin(tags, eq(tags.id, testimonialTags.tagId))
    .where(
      inArray(
        testimonialTags.testimonialId,
        rows.map((r) => r.id),
      ),
    )
    .all();
  const byId = new Map<string, string[]>();
  for (const l of links) {
    byId.set(l.testimonialId, [...(byId.get(l.testimonialId) ?? []), l.name]);
  }
  return rows.map((r) => ({ ...r, tags: (byId.get(r.id) ?? []).sort() }));
}

export function listTestimonials(
  projectId: string,
  opts: { status?: TestimonialStatus; tag?: string; limit?: number } = {},
): TestimonialWithTags[] {
  const db = getDb();
  const conditions = [eq(testimonials.projectId, projectId)];
  if (opts.status) conditions.push(eq(testimonials.status, opts.status));
  if (opts.tag) {
    const tagged = db
      .select({ id: testimonialTags.testimonialId })
      .from(testimonialTags)
      .innerJoin(tags, eq(tags.id, testimonialTags.tagId))
      .where(and(eq(tags.projectId, projectId), eq(tags.name, opts.tag)));
    conditions.push(inArray(testimonials.id, tagged));
  }
  let query = db
    .select()
    .from(testimonials)
    .where(and(...conditions))
    .orderBy(desc(testimonials.createdAt))
    .$dynamic();
  if (opts.limit) query = query.limit(opts.limit);
  return attachTags(query.all());
}

export function getTestimonial(id: string): TestimonialWithTags | null {
  const row = getDb().select().from(testimonials).where(eq(testimonials.id, id)).get();
  return row ? attachTags([row])[0] : null;
}

/**
 * Whether a stored file may be shown to the public. Testimonial files (avatar,
 * poster, every video rendition, the company logo) and attached images only
 * while their testimonial is approved and its author hasn't withdrawn consent;
 * project and form logos always; wall logos and covers while the wall is
 * published. Answer videos (questions 2..N) stay private (D13), and so does
 * every file nothing uses. One indexed query, run on every /api/media request.
 */
export function isMediaPublic(key: string) {
  return Boolean(getDb().get<{ ok: number }>(publicMediaQuery(key)));
}

/** The query behind isMediaPublic (exported so a test can check its plan uses an index for every kind of file). */
export function publicMediaQuery(key: string) {
  return sql`
    SELECT 1 AS ok FROM testimonials
      WHERE (avatar_key = ${key} OR video_key = ${key} OR video_original_key = ${key} OR poster_key = ${key} OR company_logo_key = ${key})
        AND status = 'approved' AND withdrawn_at IS NULL
    UNION ALL
    SELECT 1 FROM testimonial_images i JOIN testimonials t ON t.id = i.testimonial_id
      WHERE i.key = ${key} AND t.status = 'approved' AND t.withdrawn_at IS NULL
    UNION ALL
    SELECT 1 FROM projects WHERE logo_key = ${key}
    UNION ALL
    SELECT 1 FROM forms WHERE logo_key = ${key}
    UNION ALL
    SELECT 1 FROM walls WHERE (logo_key = ${key} OR cover_key = ${key}) AND published = 1
    LIMIT 1`;
}

export function countByStatus(projectId: string) {
  const counts: Record<TestimonialStatus, number> = { pending: 0, approved: 0, rejected: 0, hidden: 0, trashed: 0 };
  const rows = getDb()
    .select({ status: testimonials.status })
    .from(testimonials)
    .where(eq(testimonials.projectId, projectId))
    .all();
  for (const r of rows) counts[r.status]++;
  return counts;
}

export function listProjectTags(projectId: string) {
  return getDb()
    .select({ name: tags.name })
    .from(tags)
    .where(eq(tags.projectId, projectId))
    .orderBy(tags.name)
    .all()
    .map((t) => t.name);
}

/** Thrown when someone tries to publish a testimonial its author withdrew. */
export class ConsentWithdrawnError extends Error {
  constructor() {
    super("The author withdrew consent for this testimonial, so it can't be published again");
  }
}

/** Thrown when someone tries to publish a testimonial its author asked to keep private (D11). */
export class NoPublicConsentError extends Error {
  constructor() {
    super("The author asked to keep this testimonial private, so it can't be published. You can hide it to keep it for internal use");
  }
}

/** Thrown when a new platform would make the testimonial a second copy of an imported review (409). */
export class DuplicateReviewError extends Error {
  constructor(platform: string) {
    super(`Another testimonial in this project is already this review on ${platform}`);
  }
}

/** What the owner (or the API) may change on a testimonial. Trash and restore have their own calls (trash.ts). */
export type TestimonialPatch = {
  status?: TestimonialStatus;
  authorName?: string;
  authorTitle?: string | null;
  authorCompany?: string | null;
  text?: string | null;
  transcript?: string | null;
  captionsVtt?: string | null;
  rating?: number | null;
  tags?: string[];
  // Phase 1
  headline?: string | null;
  authorWebsite?: string | null;
  authorPhone?: string | null;
  authorSocials?: Record<string, string>;
  /** Set only through lib/author-images.ts, which stores the file first. */
  avatarKey?: string | null;
  companyLogoKey?: string | null;
  sourceUrl?: string | null;
  sourceDate?: Date | null;
  datePrecision?: DatePrecision;
  platform?: string | null;
  language?: string | null;
  customFields?: Record<string, unknown>;
  isFeatured?: boolean;
  pinOrder?: number | null;
};

type EditableField = Exclude<keyof TestimonialPatch, "status" | "tags">;

/** Stored as JSON text. */
const JSON_FIELDS = new Set<EditableField>(["authorSocials", "customFields"]);

/** The event a status change sends; moving to pending sends none. Leaving the trash is `testimonial.restored`. */
const STATUS_EVENTS: Partial<Record<TestimonialStatus, WebhookEvent>> = {
  approved: "testimonial.approved",
  rejected: "testimonial.rejected",
  hidden: "testimonial.hidden",
  trashed: "testimonial.trashed",
};

/** Long values (captions, transcripts) are shortened in the history; the row itself keeps them whole. */
const HISTORY_MAX = 1000;

function historyValue(v: unknown) {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && v.length > HISTORY_MAX) return `${v.slice(0, HISTORY_MAX)}…`;
  return v ?? null;
}

function parseJson(raw: string | null) {
  try {
    return JSON.parse(raw ?? "null");
  } catch {
    return null;
  }
}

function sameValue(field: EditableField, stored: unknown, next: unknown) {
  if (JSON_FIELDS.has(field)) return JSON.stringify(parseJson(stored as string)) === JSON.stringify(next);
  if (stored instanceof Date || next instanceof Date) {
    return (stored as Date | null)?.getTime() === (next as Date | null)?.getTime();
  }
  return (stored ?? null) === (next ?? null);
}

/** Words in the main text plus every answer (dates.ts countWords). */
function wordCountOf(tx: Tx, testimonialId: string, text: string | null) {
  const rows = tx.select({ text: answers.text }).from(answers).where(eq(answers.testimonialId, testimonialId)).all();
  return rows.reduce((n, a) => n + countWords(a.text), countWords(text));
}

/** Recounts a testimonial's words after its answers change, or for the maintenance backfill. */
export function refreshWordCount(tx: Tx, testimonialId: string) {
  const row = tx.select({ text: testimonials.text }).from(testimonials).where(eq(testimonials.id, testimonialId)).get();
  if (!row) return;
  tx.update(testimonials)
    .set({ wordCount: wordCountOf(tx, testimonialId, row.text) })
    .where(eq(testimonials.id, testimonialId))
    .run();
}

export function updateTestimonial(
  id: string,
  patch: TestimonialPatch,
  /**
   * `actor` is who approved (the dashboard, an API key or auto-approve) and
   * `rule` which auto-approve rule matched, for the dashboard's history line.
   * `by` is the signed-in person's email and `as` overrides the history actor
   * (an import, say). `quiet` sends no webhooks.
   */
  opts: { actor?: Approver; rule?: string; quiet?: boolean; by?: string; as?: HistoryActor } = {},
): TestimonialWithTags | null {
  const db = getDb();
  const existing = db.select().from(testimonials).where(eq(testimonials.id, id)).get();
  if (!existing) return null;
  const { tags: tagNames, status, ...edits } = patch;
  // A withdrawn testimonial can only stay unpublished or go to the trash.
  if (existing.withdrawnAt && status && !["rejected", "trashed"].includes(status)) throw new ConsentWithdrawnError();
  if (status === "approved" && existing.status !== "approved" && !existing.consentPublic) throw new NoPublicConsentError();

  const now = new Date();
  const columns: Partial<Testimonial> = {};
  const diff: Record<string, [unknown, unknown]> = {};
  for (const [field, value] of Object.entries(edits) as [EditableField, unknown][]) {
    if (value === undefined || sameValue(field, existing[field], value)) continue;
    const before = JSON_FIELDS.has(field) ? parseJson(existing[field] as string) : existing[field];
    Object.assign(columns, { [field]: JSON_FIELDS.has(field) ? JSON.stringify(value) : value });
    diff[field] = [historyValue(before), historyValue(value)];
  }
  // The import dedupe index is unique on (project, platform, review id).
  if (columns.platform && existing.sourceReviewId) {
    const taken = db
      .select({ id: testimonials.id })
      .from(testimonials)
      .where(
        and(
          eq(testimonials.projectId, existing.projectId),
          eq(testimonials.platform, columns.platform),
          eq(testimonials.sourceReviewId, existing.sourceReviewId),
          ne(testimonials.id, id),
        ),
      )
      .get();
    if (taken) throw new DuplicateReviewError(columns.platform);
  }
  // Changing what the author wrote is allowed, but recorded.
  const edited = CONSENTED_FIELDS.filter((f) => f in diff);

  const statusChanged = status !== undefined && status !== existing.status;
  if (statusChanged) {
    columns.status = status;
    // Who approved it is kept while it stays approved, and cleared when it leaves Approved. The
    // trash keeps it too, so restoring an approved testimonial puts it back exactly as it was.
    const restoringApproval = existing.status === "trashed" && status === "approved" && existing.approvedBy !== null;
    if (status === "approved" && !restoringApproval) {
      Object.assign(columns, { approvedBy: opts.actor ?? "owner", approvedAt: now, approvalRule: opts.rule ?? null });
    } else if (status !== "approved" && status !== "trashed") {
      Object.assign(columns, { approvedBy: null, approvedAt: null, approvalRule: null });
    }
    // The trash remembers where a testimonial came from, so restore can put it back.
    if (status === "trashed") Object.assign(columns, { trashedAt: now, statusBeforeTrash: existing.status });
    else if (existing.status === "trashed") Object.assign(columns, { trashedAt: null, statusBeforeTrash: null });
  }

  const before = tagNames ? (getTestimonial(id)?.tags ?? []) : [];
  const after = tagNames ? [...new Set(tagNames.map((t) => t.trim().toLowerCase()).filter(Boolean))] : [];
  const tagsChanged = Boolean(tagNames) && JSON.stringify([...after].sort()) !== JSON.stringify(before);

  const history = { testimonialId: id, actor: opts.as ?? historyActor(opts.actor), actorEmail: opts.by, at: now };
  db.transaction((tx) => {
    if ("text" in columns || existing.wordCount === null) {
      columns.wordCount = wordCountOf(tx, id, "text" in columns ? (columns.text ?? null) : existing.text);
    }
    tx.update(testimonials)
      .set({ ...columns, ...(edited.length ? { editedAfterConsent: true } : {}), updatedAt: now })
      .where(eq(testimonials.id, id))
      .run();
    if ("text" in columns) reanchorHighlights(tx, id, null, columns.text ?? null);
    if (tagNames) {
      tx.delete(testimonialTags).where(eq(testimonialTags.testimonialId, id)).run();
      for (const name of after) {
        tx.insert(tags)
          .values({ id: crypto.randomUUID(), projectId: existing.projectId, name })
          .onConflictDoNothing()
          .run();
        const tag = tx
          .select()
          .from(tags)
          .where(and(eq(tags.projectId, existing.projectId), eq(tags.name, name)))
          .get()!;
        tx.insert(testimonialTags).values({ testimonialId: id, tagId: tag.id }).run();
      }
    }
    if (Object.keys(diff).length) recordHistory(tx, { ...history, action: "edited", diff });
    if (tagsChanged) recordHistory(tx, { ...history, action: "tags", diff: { tags: [before, [...after].sort()] } });
    if (statusChanged) {
      const action = status === "trashed" ? "trashed" : existing.status === "trashed" ? "restored" : "status";
      recordHistory(tx, { ...history, action, diff: { status: [existing.status, status] } });
    }
  });
  const updated = getTestimonial(id);
  if (!opts.quiet) {
    const event = statusChanged ? (existing.status === "trashed" ? "testimonial.restored" : STATUS_EVENTS[status!]) : undefined;
    if (event) emitTestimonialEvent(event, updated);
    // Opt-in: catch-all webhooks don't get it (webhooks.ts DEFAULT_EVENTS).
    if (Object.keys(diff).length) emitTestimonialEvent("testimonial.updated", updated);
  }
  if (edited.length) {
    logConsentEvent({
      testimonialId: id,
      type: "edited",
      actor: opts.actor === "api" ? "api" : "owner",
      detail: `Changed after consent: ${edited.join(", ")}`,
    });
  }
  return updated;
}

/** Every stored file of these testimonials: their own columns, their answers' videos and their images. */
export function mediaKeysOf(ids: string[]): string[] {
  if (!ids.length) return [];
  const db = getDb();
  const keys = [
    ...db
      .select({ a: testimonials.avatarKey, b: testimonials.videoKey, c: testimonials.videoOriginalKey, d: testimonials.posterKey, e: testimonials.companyLogoKey })
      .from(testimonials)
      .where(inArray(testimonials.id, ids))
      .all()
      .flatMap((r) => Object.values(r)),
    ...db
      .select({ a: answers.videoKey, b: answers.videoOriginalKey, c: answers.posterKey })
      .from(answers)
      .where(inArray(answers.testimonialId, ids))
      .all()
      .flatMap((r) => Object.values(r)),
    ...db
      .select({ key: testimonialImages.key })
      .from(testimonialImages)
      .where(inArray(testimonialImages.testimonialId, ids))
      .all()
      .map((r) => r.key),
  ];
  return [...new Set(keys.filter((k): k is string => Boolean(k)))];
}

/** Whether any row still points at a file: another testimonial, answer or image, or a customer's photo. */
function stillUsed(key: string) {
  return Boolean(
    getDb().get(sql`
      SELECT 1 FROM testimonials
        WHERE avatar_key = ${key} OR video_key = ${key} OR video_original_key = ${key} OR poster_key = ${key} OR company_logo_key = ${key}
      UNION ALL SELECT 1 FROM answers WHERE video_key = ${key} OR video_original_key = ${key} OR poster_key = ${key}
      UNION ALL SELECT 1 FROM testimonial_images WHERE key = ${key}
      UNION ALL SELECT 1 FROM customers WHERE avatar_key = ${key}
      LIMIT 1`),
  );
}

/** Deletes the testimonial for good (cascading to its answers, images, highlights and history), then its files. */
export async function deleteTestimonial(id: string) {
  // Webhook payloads are captured before the row disappears.
  emitTestimonialEvent("testimonial.deleted", getTestimonial(id));
  const keys = mediaKeysOf([id]);
  const row = getDb().delete(testimonials).where(eq(testimonials.id, id)).returning().get();
  if (!row) return false;
  // A customer keeps the photo they sent with this testimonial. Files that
  // can't be removed now are retried in the background.
  await removeFiles(keys.filter((k) => !stillUsed(k)));
  return true;
}

// ---------------------------------------------------------------- public

/** The only shape that leaves the server for public pages and widgets. */
export interface PublicTestimonial {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  avatarUrl: string | null;
  rating: number | null;
  text: string | null;
  video: {
    url: string;
    mime: string;
    poster: string | null;
    width: number | null;
    height: number | null;
    durationMs: number | null;
    /** Every playable copy, best first, for <source> elements. */
    sources: { url: string; type: string }[];
    /** WebVTT captions, if there are any. */
    captionsUrl: string | null;
    transcript: string | null;
  } | null;
  tags: string[];
  createdAt: string;
}

// Naming the codecs lets a browser without H.264 skip straight to the original.
const PROCESSED_TYPE = 'video/mp4; codecs="avc1.640028, mp4a.40.2"';

/** The converted MP4 first (plays everywhere), then the original upload as a fallback. */
export function videoSources(t: Testimonial) {
  if (!t.videoKey) return [];
  const sources = [
    { url: mediaUrl(t.videoKey)!, type: t.mediaStatus === "ready" ? PROCESSED_TYPE : (t.videoMime ?? "video/webm") },
  ];
  if (t.mediaStatus === "ready" && t.videoOriginalKey && t.videoOriginalKey !== t.videoKey) {
    const ext = t.videoOriginalKey.split(".").pop() ?? "";
    sources.push({ url: mediaUrl(t.videoOriginalKey)!, type: MIME_BY_EXT[ext] ?? "video/webm" });
  }
  return sources;
}

export function toPublic(t: TestimonialWithTags): PublicTestimonial {
  return {
    id: t.id,
    name: t.authorName,
    title: t.authorTitle,
    company: t.authorCompany,
    avatarUrl: mediaUrl(t.avatarKey),
    rating: t.rating,
    text: t.text,
    video: t.videoKey
      ? {
          url: mediaUrl(t.videoKey)!,
          mime: t.videoMime ?? "video/webm",
          poster: mediaUrl(t.posterKey),
          width: t.videoWidth,
          height: t.videoHeight,
          durationMs: t.videoDurationMs,
          sources: videoSources(t),
          captionsUrl: t.captionsVtt ? `/api/captions/${t.id}` : null,
          transcript: t.transcript,
        }
      : null,
    tags: t.tags,
    createdAt: t.createdAt.toISOString(),
  };
}

export function listPublicTestimonials(projectId: string, opts: { tag?: string; limit?: number } = {}) {
  return listTestimonials(projectId, { ...opts, status: "approved" })
    .filter((t) => !t.withdrawnAt)
    .map(toPublic);
}
