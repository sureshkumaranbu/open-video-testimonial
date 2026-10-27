import crypto from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { SYNC_INTERVALS, type ImportSource, type TaskRun } from "@/db/schema";
import { enqueue, registerPeriodic } from "../jobs";
import { notifySyncFailing } from "../notifications";
import { getRunProgress, type RunProgress } from "../runs";
import { canSync, getAdapter } from "./registry";
import { importOptionsSchema, type ImportOptions } from "./types";

const { importSources, taskRuns } = schema;

/**
 * Auto-sync (IMP-02): "Keep this in sync" after an import keeps its source,
 * input and options, and the hourly task re-runs it every 12 or 24 hours
 * through the usual import job ("import all matching"), so the same
 * dedupe applies and a re-run never adds a review twice. A sync run stops at
 * the first page that holds nothing new. After 3 failed runs in a row the
 * owner is told (email for whoever wants import emails, and a notice in the
 * dashboard), and it keeps trying on schedule.
 */

export const SYNC_TASK = "imports.sync";
/** The import job's name (run.ts), repeated here so this module doesn't import the job runner. */
const IMPORT_PLATFORM_JOB = "import.platform";
/** Failed runs in a row before the owner is told. */
export const ALERT_AFTER = 3;
/** A run still going after this long is treated as lost, and the next one may start. */
const STUCK_MS = 6 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

export class SyncError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function parse<T>(raw: string | null | undefined, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Keys that could hold a secret never go into a source (the run's input is redacted the same way). */
const SECRET_KEYS = /key|token|secret|password/i;

/** A short name for the list: what the source reads ("acme.example", "123456789 · us"). */
export function sourceLabel(input: unknown): string {
  const parts: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string" || typeof v === "number") parts.push(String(v));
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === "object") Object.values(v).forEach(add);
  };
  if (input && typeof input === "object") for (const [k, v] of Object.entries(input)) if (!SECRET_KEYS.test(k)) add(v);
  const label = parts.filter(Boolean).join(" · ");
  return label.length > 120 ? `${label.slice(0, 119)}…` : label;
}

export const syncOptionsSchema = importOptionsSchema;
export const intervalSchema = z.union(SYNC_INTERVALS.map((n) => z.literal(n)) as [z.ZodLiteral<12>, z.ZodLiteral<24>]);

export type SyncSourceJson = {
  id: string;
  adapter: string;
  label: string;
  intervalHours: number;
  paused: boolean;
  options: ImportOptions;
  lastRunAt: string | null;
  lastStatus: "ok" | "failed" | null;
  lastError: string | null;
  failures: number;
  alerting: boolean;
  nextRunAt: string | null;
  itemsAdded: number;
  running: boolean;
  lastRun: RunProgress | null;
  createdAt: string;
};

function inFlight(run: Pick<TaskRun, "status" | "createdAt"> | null | undefined, now = Date.now()) {
  return Boolean(run && (run.status === "queued" || run.status === "running") && now - run.createdAt.getTime() < STUCK_MS);
}

function runOf(id: string | null) {
  return id ? (getDb().select().from(taskRuns).where(eq(taskRuns.id, id)).get() ?? null) : null;
}

export function toSyncJson(s: ImportSource): SyncSourceJson {
  const run = runOf(s.lastRunId);
  return {
    id: s.id,
    adapter: s.adapter,
    label: s.label,
    intervalHours: s.intervalHours,
    paused: s.paused,
    options: importOptionsSchema.parse(parse(s.options, {})),
    lastRunAt: s.lastRunAt?.toISOString() ?? null,
    lastStatus: s.lastStatus,
    lastError: s.lastError,
    failures: s.failures,
    alerting: s.failures >= ALERT_AFTER,
    nextRunAt: s.paused ? null : (s.nextRunAt?.toISOString() ?? null),
    itemsAdded: s.itemsAdded,
    running: inFlight(run),
    lastRun: run ? getRunProgress(run.id) : null,
    createdAt: s.createdAt.toISOString(),
  };
}

export function listSyncSources(projectId: string): ImportSource[] {
  return getDb().select().from(importSources).where(eq(importSources.projectId, projectId)).orderBy(asc(importSources.createdAt)).all();
}

export function getSyncSource(projectId: string, id: string): ImportSource | null {
  return getDb().select().from(importSources).where(and(eq(importSources.id, id), eq(importSources.projectId, projectId))).get() ?? null;
}

/**
 * "Keep this in sync" from a finished import: the same source, input and
 * options, every `intervalHours`. Only review sites read by a URL or an ID
 * qualify (canSync), never an uploaded file or saved page. The same source
 * twice is refused (409).
 */
export function createSyncSource(projectId: string, runId: string, intervalHours: 12 | 24, o: { by?: string; now?: Date } = {}): ImportSource {
  const db = getDb();
  const run = db.select().from(taskRuns).where(eq(taskRuns.id, runId)).get();
  if (!run || run.kind !== "import" || run.projectId !== projectId) throw new SyncError(404, "Import not found");
  const adapter = getAdapter(run.subject);
  const runOptions = parse<Record<string, unknown>>(run.options, {});
  if (!adapter || !canSync(adapter) || runOptions.fromUpload) throw new SyncError(400, "Only imports from a review site’s address or ID can be kept in sync");
  if (run.status === "previewed") throw new SyncError(409, "Import first, then keep it in sync");
  const input = Object.fromEntries(Object.entries(parse<Record<string, unknown>>(run.input, {})).filter(([k]) => !SECRET_KEYS.test(k)));
  const inputJson = JSON.stringify(input);
  const same = db
    .select({ id: importSources.id })
    .from(importSources)
    .where(and(eq(importSources.projectId, projectId), eq(importSources.adapter, adapter.id), eq(importSources.input, inputJson)))
    .get();
  if (same) throw new SyncError(409, "This source is already kept in sync. Find it under Automatically synced.");
  const { fromUpload: _u, ...options } = runOptions;
  const now = o.now ?? new Date();
  return db
    .insert(importSources)
    .values({
      id: crypto.randomUUID(),
      projectId,
      adapter: adapter.id,
      input: inputJson,
      options: JSON.stringify(importOptionsSchema.parse(options)),
      label: sourceLabel(input),
      intervalHours,
      nextRunAt: new Date(now.getTime() + intervalHours * HOUR),
      lastRunId: run.id,
      createdBy: o.by ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export const syncPatchSchema = z
  .object({ paused: z.boolean(), intervalHours: intervalSchema, options: importOptionsSchema })
  .partial();

/** Pause or resume, change the interval or the options. Resuming a source that's overdue runs it on the next hourly tick. */
export function updateSyncSource(projectId: string, id: string, patch: z.infer<typeof syncPatchSchema>, now = new Date()): ImportSource {
  const s = getSyncSource(projectId, id);
  if (!s) throw new SyncError(404, "Synced source not found");
  const set: Partial<ImportSource> = { updatedAt: now };
  if (patch.paused !== undefined) set.paused = patch.paused;
  if (patch.options) set.options = JSON.stringify(patch.options);
  if (patch.intervalHours) {
    set.intervalHours = patch.intervalHours;
    set.nextRunAt = new Date((s.lastRunAt ?? now).getTime() + patch.intervalHours * HOUR);
  }
  return getDb().update(importSources).set(set).where(eq(importSources.id, s.id)).returning().get()!;
}

export function deleteSyncSource(projectId: string, id: string): boolean {
  return getDb().delete(importSources).where(and(eq(importSources.id, id), eq(importSources.projectId, projectId))).run().changes > 0;
}

/**
 * Starts one run of a source: a task_runs row for "all matching" and the
 * import job. One at a time: a run still going is returned as it is.
 */
export function startSyncRun(s: ImportSource, now = new Date()): TaskRun {
  const db = getDb();
  const current = runOf(s.lastRunId);
  if (current && inFlight(current, now.getTime())) return current;
  return db.transaction((tx) => {
    const run = tx
      .insert(taskRuns)
      .values({
        id: crypto.randomUUID(),
        projectId: s.projectId,
        kind: "import",
        subject: s.adapter,
        input: s.input,
        options: s.options,
        preview: "[]",
        selection: '"all"',
        status: "queued",
        createdBy: s.createdBy,
        createdAt: now,
        sourceId: s.id,
      })
      .returning()
      .get();
    const job = enqueue(IMPORT_PLATFORM_JOB, { runId: run.id }, { maxAttempts: 3 });
    tx.update(taskRuns).set({ jobId: job.id }).where(eq(taskRuns.id, run.id)).run();
    // Tentatively next time already, so a run that's lost for good doesn't stop the schedule.
    tx.update(importSources).set({ lastRunId: run.id, nextRunAt: new Date(now.getTime() + s.intervalHours * HOUR), updatedAt: now }).where(eq(importSources.id, s.id)).run();
    return run;
  });
}

/** The hourly task: starts every source that's due and not paused. Returns how many it started. */
export function runDueSyncs(now = new Date()): number {
  const due = getDb()
    .select()
    .from(importSources)
    .where(and(eq(importSources.paused, false), isNotNull(importSources.nextRunAt), lte(importSources.nextRunAt, now)))
    .orderBy(asc(importSources.nextRunAt))
    .limit(200)
    .all();
  let started = 0;
  for (const s of due) {
    const before = s.lastRunId;
    const run = startSyncRun(s, now);
    if (run.id !== before) started++;
  }
  return started;
}

/**
 * Called by the import job when a sync run ends: records the result on its
 * source, counts failures in a row and tells the owner at the third.
 */
export function noteSyncResult(run: TaskRun, now = new Date()) {
  if (!run.sourceId) return;
  const db = getDb();
  const s = db.select().from(importSources).where(eq(importSources.id, run.sourceId)).get();
  if (!s) return;
  const ok = run.status === "done";
  const errors = parse<{ message?: string }[]>(run.errors, []);
  const failures = ok ? 0 : s.failures + 1;
  const alert = !ok && failures >= ALERT_AFTER && !s.alertedAt;
  // When it ran: the later of its start and its end (a run can't end before it started).
  const at = new Date(Math.max((run.finishedAt ?? now).getTime(), run.createdAt.getTime()));
  db.update(importSources)
    .set({
      lastRunAt: at,
      lastStatus: ok ? "ok" : "failed",
      lastError: ok ? null : String(errors.at(-1)?.message ?? "The import stopped early").slice(0, 500),
      failures,
      alertedAt: ok ? null : alert ? now : s.alertedAt,
      itemsAdded: s.itemsAdded + (ok ? run.done : 0),
      nextRunAt: new Date(at.getTime() + s.intervalHours * HOUR),
      updatedAt: now,
    })
    .where(eq(importSources.id, s.id))
    .run();
  if (alert) notifySyncFailing(s.projectId, s.id);
}

/** Sources failing 3 or more times in a row, for the dashboard's notices (IMP-02). */
export function failingSyncs(projectIds?: string[]) {
  const rows = getDb()
    .select({ id: importSources.id, projectId: importSources.projectId, adapter: importSources.adapter, label: importSources.label, failures: importSources.failures, lastError: importSources.lastError, lastRunAt: importSources.lastRunAt })
    .from(importSources)
    .where(and(gte(importSources.failures, ALERT_AFTER), projectIds ? inArray(importSources.projectId, projectIds) : undefined))
    .orderBy(desc(importSources.lastRunAt))
    .all();
  return rows.map((r) => ({ ...r, label: getAdapter(r.adapter)?.label ? `${getAdapter(r.adapter)!.label}${r.label ? `: ${r.label}` : ""}` : r.label, lastRunAt: r.lastRunAt?.toISOString() ?? null }));
}
export type FailingSync = ReturnType<typeof failingSyncs>[number];

export function registerSyncJobs(): void {
  registerPeriodic(SYNC_TASK, HOUR, () => runDueSyncs());
}
