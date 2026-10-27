import crypto from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { DatePrecision, Project, TaskRun } from "@/db/schema";
import { logConsentEvent } from "../consent";
import { upsertCustomer } from "../customers";
import { FETCH_MEDIA_JOB, isAlreadyImported, isUniqueViolation, normalizePlatform } from "../csv-import";
import { enqueue, PermanentJobError } from "../jobs";
import { NetGuardError } from "../net-guard";
import { getRunProgress, MAX_RUN_ERRORS, toRunProgress, type RunProgress } from "../runs";
import { createTestimonial, getProjectById, updateTestimonial } from "../testimonials";
import { emitEvent } from "../webhooks";
import { cleanLine, cleanText, httpUrl } from "./html";
import { getAdapter, importCtx } from "./registry";
import { noteSyncResult } from "./sync";
import {
  ImporterBlockedError,
  ImporterInputError,
  importOptionsSchema,
  MAX_IMPORT_ITEMS,
  PREVIEW_SIZE,
  type ImportCtx,
  type ImportedReview,
  type ImporterAdapter,
  type ImportOptions,
  type PreviewItem,
} from "./types";

/**
 * One importer flow for every source (IMP-01): preview → select → import.
 *
 * - previewImport fetches the latest items that match the owner's options
 *   (at most 50, within 15 s) and keeps them on a task_runs row, so "Import
 *   selected" imports exactly what the owner saw.
 * - startImport queues `import.platform` for the selection or for "all
 *   matching" (up to 1,000).
 * - runImportJob does one chunk (a page of up to 50) per job and re-enqueues
 *   itself with a cursor. Each item is saved in the same transaction as the
 *   run's counters and cursor, so a retried job carries on where it stopped
 *   and never counts an item twice. Rows are deduped on (project, platform,
 *   source review id); no per-row webhooks go out, media URLs go to
 *   `import.media`, and exactly one `import.completed` fires when the run ends.
 */

export const IMPORT_PLATFORM_JOB = "import.platform";
const PREVIEW_BUDGET_MS = 15_000;

/** Why a preview or start can't go ahead; `code` "blocked" offers the saved-page upload. */
export class ImportError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: "blocked" | "unavailable" | "input" | "ownership",
  ) {
    super(message);
  }
}

let fetchOverride: ImportCtx["fetchText"] | null = null;
/** Tests only: answer every importer request with this instead of the network. */
export function setImportFetch(fn: ImportCtx["fetchText"] | null) {
  fetchOverride = fn;
}
const ctxFor = (adapter: ImporterAdapter, limit: number) => importCtx(adapter, limit, fetchOverride ?? undefined);

// ----------------------------------------------------------------- items

type StoredItem = Omit<ImportedReview, "date"> & { date?: { value: string; precision: DatePrecision } };

/**
 * An adapter's item made safe to store: plain text with length caps,
 * http(s) URLs only, whole 1–5 stars, a bounded id. Null when it has no id,
 * or nothing to show.
 */
export function sanitizeItem(r: ImportedReview, adapter: Pick<ImporterAdapter, "platform">): StoredItem | null {
  const id = typeof r.sourceReviewId === "string" ? r.sourceReviewId.trim().slice(0, 200) : "";
  if (!id) return null;
  const text = cleanText(r.text);
  const videoUrl = httpUrl(r.videoUrl);
  const headline = cleanLine(r.headline, 200);
  const rating = typeof r.rating === "number" && Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5 ? r.rating : undefined;
  if (!text && !videoUrl && !headline && rating === undefined) return null;
  const date = r.date && r.date.value instanceof Date && Number.isFinite(r.date.value.getTime()) ? r.date : undefined;
  return {
    sourceReviewId: id,
    authorName: cleanLine(r.authorName) ?? "Anonymous",
    authorTitle: cleanLine(r.authorTitle),
    authorCompany: cleanLine(r.authorCompany),
    avatarUrl: httpUrl(r.avatarUrl),
    rating,
    headline: headline && headline !== text ? headline : undefined,
    text,
    url: httpUrl(r.url),
    date: date ? { value: date.value.toISOString(), precision: date.precision } : undefined,
    language: typeof r.language === "string" && /^[a-zA-Z]{2,3}([-_][a-zA-Z0-9]{2,8})*$/.test(r.language) ? r.language.slice(0, 16) : undefined,
    videoUrl,
    imageUrls: (r.imageUrls ?? []).map((u) => httpUrl(u)).filter((u): u is string => Boolean(u)).slice(0, 5),
    platform: normalizePlatform(r.platform) ?? adapter.platform,
  };
}

/** Whether an item passes the owner's options: false means it's skipped. */
export function matches(item: StoredItem, o: ImportOptions) {
  if (o.minRating && (item.rating ?? 0) < o.minRating) return false;
  if (o.skipEmpty && !item.text && !item.videoUrl) return false;
  return true;
}

function toPreviewItem(item: StoredItem, alreadyImported: boolean): PreviewItem {
  return {
    id: item.sourceReviewId,
    authorName: item.authorName,
    authorTitle: item.authorTitle ?? null,
    authorCompany: item.authorCompany ?? null,
    avatarUrl: item.avatarUrl ?? null,
    rating: item.rating ?? null,
    headline: item.headline ?? null,
    text: item.text ?? null,
    url: item.url ?? null,
    date: item.date?.value ?? null,
    datePrecision: item.date?.precision ?? "day",
    language: item.language ?? null,
    videoUrl: item.videoUrl ?? null,
    platform: item.platform ?? "",
    alreadyImported,
  };
}

function parseList<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Keys that hold someone's API key; dropped from a run's saved input once it ends. */
const SECRET_KEYS = /key|token|secret|password/i;
function redact(input: string) {
  const o = parseList<Record<string, unknown>>(input, {});
  if (!o || typeof o !== "object") return "{}";
  return JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => !SECRET_KEYS.test(k))));
}

// ----------------------------------------------------------------- preview

export type PreviewResult = { run: RunProgress; items: PreviewItem[]; more: boolean };

function friendly(err: unknown, adapter: ImporterAdapter): ImportError {
  if (err instanceof ImportError) return err;
  if (err instanceof ImporterBlockedError) return new ImportError(422, err.message, "blocked");
  if (err instanceof ImporterInputError) return new ImportError(400, err.message, "input");
  if (err instanceof NetGuardError) return new ImportError(400, err.message, "input");
  const msg = err instanceof Error ? err.message : String(err);
  return new ImportError(502, `We couldn't read ${adapter.label} (${msg.replace(/\.$/, "")}). Try again in a moment${adapter.parseHtml ? ", or upload the saved page instead" : ""}.`, adapter.parseHtml ? "blocked" : undefined);
}

export type PreviewUpload = { kind: "html" | "file"; text: string };

/**
 * Fetches (or parses an uploaded page or file) and keeps the latest matching
 * items on a new task_runs row with status "previewed". The ownership
 * checkbox (IMP-03) is checked here, so no client can skip it.
 */
export async function previewImport(
  projectId: string,
  adapterId: string,
  input: unknown,
  rawOptions: unknown,
  o: { confirmOwnership: unknown; by?: string; upload?: PreviewUpload },
): Promise<PreviewResult> {
  if (o.confirmOwnership !== true) {
    throw new ImportError(400, "Tick “I own or manage this listing” to import from it", "ownership");
  }
  const project = getProjectById(projectId);
  if (!project) throw new ImportError(404, "Project not found");
  const adapter = getAdapter(adapterId);
  if (!adapter || adapter.unlisted) throw new ImportError(400, "Choose a source to import from");
  const parsedOptions = importOptionsSchema.safeParse(rawOptions ?? {});
  if (!parsedOptions.success) throw new ImportError(400, parsedOptions.error.issues[0]?.message ?? "Check the import options");
  const options = parsedOptions.data;

  let stored: StoredItem[] = [];
  let more = false;
  let savedInput: unknown;
  let fromUpload = false;

  if (o.upload) {
    const parse = o.upload.kind === "html" ? adapter.parseHtml : adapter.parseFile;
    if (!parse) throw new ImportError(400, o.upload.kind === "html" ? `${adapter.label} doesn't take a saved page` : `${adapter.label} doesn't take a file`);
    let raw: ImportedReview[];
    try {
      raw = parse.call(adapter, o.upload.text);
    } catch (err) {
      throw new ImportError(400, `We couldn't read that file (${(err as Error).message.replace(/\.$/, "")}).`, "input");
    }
    const all = raw.map((r) => sanitizeItem(r, adapter)).filter((r): r is StoredItem => r !== null);
    if (!all.length) {
      throw new ImportError(400, o.upload.kind === "html" ? "We couldn't find any reviews on that page. Save the page with its reviews showing, or use a CSV." : "We couldn't find any testimonials in that file.", "input");
    }
    stored = uniqueById(all.filter((r) => matches(r, options))).slice(0, MAX_IMPORT_ITEMS);
    more = stored.length > PREVIEW_SIZE;
    savedInput = { upload: o.upload.kind };
    fromUpload = true;
  } else {
    const missing = adapter.unavailable?.();
    if (missing) throw new ImportError(400, missing, "unavailable");
    const parsedInput = adapter.input.safeParse(input ?? {});
    if (!parsedInput.success) throw new ImportError(400, parsedInput.error.issues[0]?.message ?? "Check what you typed", "input");
    savedInput = parsedInput.data;
    const deadline = Date.now() + PREVIEW_BUDGET_MS;
    let cursor: string | null = null;
    let first = true;
    const seen = new Set<string>();
    for (let page = 0; page < 40; page++) {
      let result;
      try {
        result = await adapter.fetchPage(savedInput, cursor, ctxFor(adapter, PREVIEW_SIZE));
      } catch (err) {
        // A later page failing still leaves a preview of what came through.
        if (first) throw friendly(err, adapter);
        more = true;
        break;
      }
      first = false;
      for (const r of result.items) {
        const item = sanitizeItem(r, adapter);
        if (!item || seen.has(item.sourceReviewId) || !matches(item, options)) continue;
        seen.add(item.sourceReviewId);
        if (stored.length < PREVIEW_SIZE) stored.push(item);
        else more = true;
      }
      cursor = result.next;
      if (!cursor) break;
      if (stored.length >= PREVIEW_SIZE || Date.now() > deadline) {
        more = true;
        break;
      }
    }
    if (!stored.length && first === false && !more) {
      // Nothing matched: still a valid preview (the dashboard says so).
    }
  }

  const shown = stored.slice(0, PREVIEW_SIZE);
  const known = alreadyImportedIds(project.id, shown);
  const now = new Date();
  const row = getDb()
    .insert(schema.taskRuns)
    .values({
      id: crypto.randomUUID(),
      projectId: project.id,
      kind: "import",
      subject: adapter.id,
      input: JSON.stringify(savedInput ?? {}),
      options: JSON.stringify({ ...options, fromUpload }),
      preview: JSON.stringify(stored),
      selection: '"all"',
      status: "previewed",
      total: fromUpload ? stored.length : shown.length,
      createdBy: o.by ?? null,
      createdAt: now,
    })
    .returning()
    .get();
  return {
    run: getRunProgress(row.id)!,
    items: shown.map((item) => toPreviewItem(item, known.has(item.sourceReviewId))),
    more,
  };
}

function uniqueById(items: StoredItem[]) {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.sourceReviewId) ? false : (seen.add(i.sourceReviewId), true)));
}

function alreadyImportedIds(projectId: string, items: StoredItem[]) {
  const out = new Set<string>();
  for (const item of items) {
    if (isAlreadyImported(projectId, item.platform!, item.sourceReviewId)) out.add(item.sourceReviewId);
  }
  return out;
}

// ----------------------------------------------------------------- start

function getRun(id: string): TaskRun | null {
  return getDb().select().from(schema.taskRuns).where(eq(schema.taskRuns.id, id)).get() ?? null;
}

/**
 * Queues the import of a previewed run: the chosen preview items, or "all"
 * matching items (up to 1,000; for an upload, everything it held). A run
 * starts once; a second click gets 409.
 */
export function startImport(runId: string, selection: "all" | string[], o: { projectId?: string } = {}): RunProgress {
  const run = getRun(runId);
  if (!run || run.kind !== "import" || (o.projectId && run.projectId !== o.projectId)) throw new ImportError(404, "Import not found");
  if (run.status !== "previewed") throw new ImportError(409, "This import has already started");
  const stored = parseList<StoredItem[]>(run.preview, []);
  const fromUpload = Boolean(parseList<{ fromUpload?: boolean }>(run.options, {}).fromUpload);
  let total: number;
  if (selection === "all") {
    total = fromUpload ? stored.length : 0;
  } else {
    const ids = new Set(stored.slice(0, fromUpload ? MAX_IMPORT_ITEMS : PREVIEW_SIZE).map((i) => i.sourceReviewId));
    const unique = [...new Set(selection)];
    if (!unique.length) throw new ImportError(400, "Choose at least one testimonial to import");
    if (unique.some((id) => !ids.has(id))) throw new ImportError(400, "Some of the chosen items aren't in this preview. Preview again.");
    selection = unique;
    total = unique.length;
  }
  const db = getDb();
  const started = db.transaction((tx) => {
    const res = tx
      .update(schema.taskRuns)
      .set({ status: "queued", selection: JSON.stringify(selection), total, cursor: null })
      .where(and(eq(schema.taskRuns.id, run.id), eq(schema.taskRuns.status, "previewed")))
      .run();
    if (res.changes !== 1) return false;
    const job = enqueue(IMPORT_PLATFORM_JOB, { runId: run.id }, { maxAttempts: 3 });
    tx.update(schema.taskRuns).set({ jobId: job.id }).where(eq(schema.taskRuns.id, run.id)).run();
    return true;
  });
  if (!started) throw new ImportError(409, "This import has already started");
  return getRunProgress(run.id)!;
}

// ----------------------------------------------------------------- the job

type Cursor = { c: string | null; i: number };
type Outcome = "done" | "duplicates" | "skipped" | "failed";

function saveItem(project: Project, adapter: ImporterAdapter, run: TaskRun, item: StoredItem, options: ImportOptions): Exclude<Outcome, "failed"> {
  if (!matches(item, options)) return "skipped";
  const platform = item.platform ?? adapter.platform;
  if (isAlreadyImported(project.id, platform, item.sourceReviewId)) return "duplicates";
  const now = new Date();
  let id: string;
  try {
    // INBOX-12: every imported review gets its person (no email from a review site, so a record of their own).
    const customer = upsertCustomer(project.id, { name: item.authorName, title: item.authorTitle, company: item.authorCompany });
    id = createTestimonial(
      project.id,
      {
        name: item.authorName,
        title: item.authorTitle,
        company: item.authorCompany,
        rating: item.rating,
        text: item.text,
        headline: item.headline,
        platform,
        sourceUrl: item.url,
        sourceReviewId: item.sourceReviewId,
        sourceDate: item.date ? new Date(item.date.value) : undefined,
        datePrecision: item.date?.precision ?? "day",
        importedAt: now,
        language: item.language,
        customerId: customer?.id ?? null,
      },
      { source: `importer:${adapter.id}`, createdAt: now, by: run.createdBy ?? undefined },
    ).id;
  } catch (err) {
    // The same review saved a moment ago by another import of this project.
    if (isUniqueViolation(err)) return "duplicates";
    throw err;
  }
  logConsentEvent({
    testimonialId: id,
    type: "imported",
    actor: "import",
    detail: `Imported from ${adapter.label}. Consent was collected outside Plaudit; keep your own record of it.`,
  });
  if (options.tags.length || options.status === "approved") {
    // Bulk imports send no per-row webhooks.
    updateTestimonial(
      id,
      { tags: options.tags.length ? options.tags.map((t) => t.toLowerCase()) : undefined, status: options.status === "approved" ? "approved" : undefined },
      { quiet: true, as: "import", by: run.createdBy ?? undefined },
    );
  }
  if (item.videoUrl || item.avatarUrl) {
    enqueue(FETCH_MEDIA_JOB, { testimonialId: id, videoUrl: item.videoUrl ?? null, avatarUrl: item.avatarUrl ?? null }, { maxAttempts: 3 });
  }
  return "done";
}

function bump(runId: string, outcome: Outcome, cursor: Cursor, error?: { item: string; message: string }) {
  const t = schema.taskRuns;
  const db = getDb();
  db.transaction((tx) => {
    const counter = {
      done: { done: sql`${t.done} + 1` },
      duplicates: { duplicates: sql`${t.duplicates} + 1` },
      skipped: { skipped: sql`${t.skipped} + 1` },
      failed: { failed: sql`${t.failed} + 1` },
    }[outcome];
    let errors: string | undefined;
    if (error) {
      const row = tx.select({ errors: t.errors }).from(t).where(eq(t.id, runId)).get();
      const list = parseList<unknown[]>(row?.errors, []);
      // Keep the first problems; the count says how many there were.
      if (list.length < MAX_RUN_ERRORS * 5) errors = JSON.stringify([...list, error]);
    }
    tx.update(t)
      .set({ ...counter, cursor: JSON.stringify(cursor), ...(errors ? { errors } : {}) })
      .where(eq(t.id, runId))
      .run();
  });
}

/** Saves one item and moves the cursor past it in one transaction: a retry never repeats it. */
function processItem(project: Project, adapter: ImporterAdapter, run: TaskRun, item: StoredItem, options: ImportOptions, next: Cursor) {
  const db = getDb();
  try {
    db.transaction(() => {
      const outcome = saveItem(project, adapter, run, item, options);
      bump(run.id, outcome, next);
    });
  } catch (err) {
    bump(run.id, "failed", next, { item: item.authorName, message: (err as Error).message || "Couldn't save it" });
  }
}

/** Matching items handled so far: "all matching" stops at MAX_IMPORT_ITEMS of these (skipped ones don't count). */
function handled(runId: string) {
  const r = getRun(runId);
  return r ? r.done + r.duplicates + r.failed : 0;
}

function finish(runId: string, project: Project, adapter: ImporterAdapter) {
  const t = schema.taskRuns;
  const db = getDb();
  const ended = db.transaction((tx) => {
    const res = tx
      .update(t)
      .set({
        status: "done",
        finishedAt: new Date(),
        cursor: null,
        total: sql`MAX(${t.total}, ${t.done} + ${t.duplicates} + ${t.skipped} + ${t.failed})`,
      })
      .where(and(eq(t.id, runId), eq(t.status, "running")))
      .run();
    return res.changes === 1;
  });
  const run = getRun(runId);
  if (!run) return;
  db.update(t).set({ input: redact(run.input), preview: "[]" }).where(eq(t.id, runId)).run();
  // Exactly one per run: only the call that moved it to "done" announces it. A sync run that found nothing new says nothing (IMP-02).
  if (ended && (!run.sourceId || run.done > 0)) {
    emitEvent("import.completed", project, {
      import: {
        id: run.id,
        source: adapter.id,
        platform: adapter.platform,
        imported: run.done,
        duplicates: run.duplicates,
        skipped: run.skipped,
        failed: run.failed,
        startedAt: run.createdAt.toISOString(),
        finishedAt: (run.finishedAt ?? new Date()).toISOString(),
        ...(run.sourceId ? { syncId: run.sourceId } : {}),
      },
    });
  }
  if (ended) noteSyncResult(run);
}

function fail(runId: string, message: string) {
  const t = schema.taskRuns;
  const run = getRun(runId);
  if (!run || run.status === "done" || run.status === "failed") return;
  const errors = [...parseList<unknown[]>(run.errors, []), { message }];
  getDb()
    .update(t)
    .set({ status: "failed", finishedAt: new Date(), errors: JSON.stringify(errors), input: redact(run.input), preview: "[]" })
    .where(eq(t.id, runId))
    .run();
  const failed = getRun(runId);
  if (failed) noteSyncResult(failed);
}

function requeue(runId: string) {
  const job = enqueue(IMPORT_PLATFORM_JOB, { runId }, { maxAttempts: 3 });
  getDb().update(schema.taskRuns).set({ jobId: job.id }).where(eq(schema.taskRuns.id, runId)).run();
}

/**
 * One chunk of an import run. Idempotent: a finished or deleted run is left
 * alone, and the cursor (saved with every item) says where to carry on.
 * `final` is the job's last attempt: a failure then ends the run as failed.
 */
export async function runImportJob(p: { runId: string }, o: { final?: boolean } = {}): Promise<void> {
  const run = getRun(p.runId);
  if (!run || run.kind !== "import" || run.status === "done" || run.status === "failed" || run.status === "previewed") return;
  const adapter = getAdapter(run.subject);
  const project = run.projectId ? getProjectById(run.projectId) : null;
  if (!project) return;
  if (!adapter) {
    fail(run.id, "This source isn't available any more");
    return;
  }
  if (run.status === "queued") {
    getDb().update(schema.taskRuns).set({ status: "running" }).where(eq(schema.taskRuns.id, run.id)).run();
  }
  const options = importOptionsSchema.parse({ ...parseList<object>(run.options, {}) });
  const fromUpload = Boolean(parseList<{ fromUpload?: boolean }>(run.options, {}).fromUpload);
  const selection = parseList<"all" | string[]>(run.selection, "all");
  const cursor = parseList<Cursor>(run.cursor, { c: null, i: 0 });
  const stored = parseList<StoredItem[]>(run.preview, []);

  // The owner's selection, or everything an upload held: no fetching.
  if (Array.isArray(selection) || fromUpload) {
    const wanted = Array.isArray(selection) ? new Set(selection) : null;
    const list = wanted ? stored.filter((i) => wanted.has(i.sourceReviewId)) : stored;
    const end = Math.min(cursor.i + PREVIEW_SIZE, list.length, MAX_IMPORT_ITEMS);
    for (let i = cursor.i; i < end; i++) processItem(project, adapter, run, list[i], options, { c: null, i: i + 1 });
    if (end < Math.min(list.length, MAX_IMPORT_ITEMS)) requeue(run.id);
    else finish(run.id, project, adapter);
    return;
  }

  // "Import all matching": one page per job.
  const input = parseList<unknown>(run.input, {});
  let page;
  try {
    page = await adapter.fetchPage(input, cursor.c, ctxFor(adapter, PREVIEW_SIZE));
  } catch (err) {
    const permanent = err instanceof ImporterBlockedError || err instanceof ImporterInputError || err instanceof PermanentJobError;
    if (permanent || o.final) {
      fail(run.id, friendly(err, adapter).message);
      return;
    }
    throw err;
  }
  if (page.total && run.total === 0) {
    getDb().update(schema.taskRuns).set({ total: Math.min(page.total, MAX_IMPORT_ITEMS) }).where(eq(schema.taskRuns.id, run.id)).run();
  }
  const before = getRun(run.id);
  for (let i = cursor.i; i < page.items.length; i++) {
    if (handled(run.id) >= MAX_IMPORT_ITEMS) break;
    const item = sanitizeItem(page.items[i], adapter);
    const next = { c: cursor.c, i: i + 1 };
    if (!item) {
      bump(run.id, "skipped", next);
      continue;
    }
    processItem(project, adapter, run, item, options, next);
  }
  // A sync run (IMP-02) stops at the first page with nothing new: the source lists newest first.
  const after = getRun(run.id);
  const nothingNew = Boolean(run.sourceId && before && after && after.done === before.done && after.duplicates > before.duplicates);
  if (page.next && !nothingNew && handled(run.id) < MAX_IMPORT_ITEMS) {
    getDb().update(schema.taskRuns).set({ cursor: JSON.stringify({ c: page.next, i: 0 }) }).where(eq(schema.taskRuns.id, run.id)).run();
    requeue(run.id);
  } else {
    finish(run.id, project, adapter);
  }
}

/** How long a preview that was never imported is kept (with any API key typed for it). */
export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

/** Deletes previews nobody imported, so saved inputs (API keys) don't linger. Returns how many. */
export function cleanupStalePreviews(now = new Date()) {
  const t = schema.taskRuns;
  return getDb()
    .delete(t)
    .where(and(eq(t.kind, "import"), eq(t.status, "previewed"), sql`${t.createdAt} < ${now.getTime() - PREVIEW_TTL_MS}`))
    .run().changes;
}

/** The project's recent imports, newest first, for the history list. */
export function listImportRuns(projectId: string, limit = 20): RunProgress[] {
  const t = schema.taskRuns;
  return getDb()
    .select()
    .from(t)
    .where(and(eq(t.projectId, projectId), eq(t.kind, "import")))
    .orderBy(desc(t.createdAt))
    .limit(limit)
    .all()
    .filter((r) => r.status !== "previewed")
    .map((r) =>
      toRunProgress({
        id: r.id,
        project_id: r.projectId,
        kind: r.kind,
        subject: r.subject,
        status: r.status,
        total: r.total,
        done: r.done,
        duplicates: r.duplicates,
        skipped: r.skipped,
        failed: r.failed,
        errors: r.errors,
        created_at: r.createdAt.getTime(),
        finished_at: r.finishedAt ? r.finishedAt.getTime() : null,
      }),
    );
}
