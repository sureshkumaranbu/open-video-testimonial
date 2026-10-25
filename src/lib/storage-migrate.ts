import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "./env";
import { enqueue, getJob, registerJob } from "./jobs";
import { getRunProgress, type RunError, type RunProgress } from "./runs";
import { isMediaKey, localDisk, mimeForKey, resolveKey, s3Storage, storageStatus } from "./storage";
import type { S3Driver } from "./storage/s3";

const { taskRuns } = schema;

/**
 * "Copy local media to S3" (TEAM-05): an owner-started background task run
 * that puts every file under DATA_DIR/uploads into the bucket. It works in
 * batches that re-enqueue themselves, so video conversion and emails aren't
 * held up behind a long copy, and it HEADs each object before putting it, so
 * running it again (or a retry) copies only what's missing. Local copies stay
 * unless the owner asks for them to go; until then they're served from disk.
 */
export const STORAGE_MIGRATE_JOB = "storage.migrate";

const SUBJECT = "local->s3";
/** One batch stops after this many files or this long, whichever comes first. */
export const MIGRATE_BATCH_FILES = 25;
const MIGRATE_BATCH_MS = 60_000;
/** Per-file problems kept on the run; `failed` still counts them all. */
const MAX_STORED_ERRORS = 200;

/** Why a copy can't start, in words for the owner (409). */
export class StorageMigrationError extends Error {}

type MigrateOptions = { deleteLocal: boolean };

function parseOptions(raw: string): MigrateOptions {
  try {
    return { deleteLocal: Boolean((JSON.parse(raw) as Partial<MigrateOptions>).deleteLocal) };
  } catch {
    return { deleteLocal: false };
  }
}

function parseErrors(raw: string): RunError[] {
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Every media key on local disk, in the order the copy walks them. */
export async function localMediaKeys(): Promise<string[]> {
  const keys: string[] = [];
  for (const dir of ["images", "videos"]) {
    const names = await fs.promises
      .readdir(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ env.uploadsDir, dir))
      .catch(() => [] as string[]);
    for (const name of names) if (isMediaKey(`${dir}/${name}`)) keys.push(`${dir}/${name}`);
  }
  return keys.sort();
}

/** The most recent copy, finished or not. */
export function latestStorageMigration(): RunProgress | null {
  const row = getDb()
    .select({ id: taskRuns.id })
    .from(taskRuns)
    .where(eq(taskRuns.kind, "storage-migrate"))
    .orderBy(desc(taskRuns.createdAt), sql`rowid DESC`)
    .limit(1)
    .get();
  return row ? getRunProgress(row.id) : null;
}

/** Starts a copy. Needs STORAGE_DRIVER=s3 and a reachable bucket, and only one runs at a time. */
export async function startStorageMigration(o: { deleteLocal?: boolean; by?: string } = {}): Promise<RunProgress> {
  if (env.storageDriver !== "s3") {
    throw new StorageMigrationError("Media is stored on local disk. Set STORAGE_DRIVER=s3 and the S3_* settings, restart Plaudit, then copy.");
  }
  const status = await storageStatus({ fresh: true });
  if (!status.ok) throw new StorageMigrationError(`The bucket can't be reached: ${status.error}`);
  const db = getDb();
  const active = db
    .select({ id: taskRuns.id, jobId: taskRuns.jobId })
    .from(taskRuns)
    .where(and(eq(taskRuns.kind, "storage-migrate"), inArray(taskRuns.status, ["queued", "running"])))
    .get();
  if (active) {
    const job = active.jobId ? getJob(active.jobId) : null;
    if (job && (job.status === "queued" || job.status === "running")) throw new StorageMigrationError("A copy is already running.");
    // Its job gave up (a crash it couldn't recover from): close it so a new copy can start.
    db.update(taskRuns).set({ status: "failed", finishedAt: new Date() }).where(eq(taskRuns.id, active.id)).run();
  }
  const id = crypto.randomUUID();
  db.insert(taskRuns)
    .values({
      id,
      kind: "storage-migrate",
      subject: SUBJECT,
      options: JSON.stringify({ deleteLocal: Boolean(o.deleteLocal) } satisfies MigrateOptions),
      status: "queued",
      createdBy: o.by ?? null,
      createdAt: new Date(),
    })
    .run();
  const job = enqueue(STORAGE_MIGRATE_JOB, { runId: id }, { maxAttempts: 3 });
  db.update(taskRuns).set({ jobId: job.id }).where(eq(taskRuns.id, id)).run();
  return getRunProgress(id)!;
}

/** Copies the next batch of files; idempotent: HEAD before PUT; local copies are kept unless asked. */
export async function runStorageMigration(p: { runId: string }): Promise<void> {
  const db = getDb();
  const run = db.select().from(taskRuns).where(eq(taskRuns.id, p.runId)).get();
  if (!run || run.kind !== "storage-migrate" || run.status === "done" || run.status === "failed") return;
  const errors = parseErrors(run.errors);
  const fail = (message: string) =>
    db
      .update(taskRuns)
      .set({ status: "failed", errors: JSON.stringify([...errors, { message }]), finishedAt: new Date() })
      .where(eq(taskRuns.id, run.id))
      .run();

  if (env.storageDriver !== "s3") {
    fail("STORAGE_DRIVER isn't s3 any more, so there's nowhere to copy to.");
    return;
  }
  let bucket: S3Driver;
  try {
    bucket = s3Storage();
    await bucket.check();
  } catch (err) {
    // Most likely a setting to fix rather than a blip: stop, and the owner starts again.
    fail(`The bucket can't be reached: ${(err as Error).message}`);
    return;
  }

  const { deleteLocal } = parseOptions(run.options);
  const pending = (await localMediaKeys()).filter((k) => !run.cursor || k > run.cursor);
  const counts = { done: run.done, duplicates: run.duplicates, skipped: run.skipped, failed: run.failed };
  const save = (cursor: string | null, left: number, finished: boolean) =>
    db
      .update(taskRuns)
      .set({
        ...counts,
        status: finished ? "done" : "running",
        // Files can come and go during a long copy, so the total is what's handled plus what's left.
        total: counts.done + counts.duplicates + counts.skipped + counts.failed + left,
        cursor,
        errors: JSON.stringify(errors.slice(0, MAX_STORED_ERRORS)),
        finishedAt: finished ? new Date() : null,
      })
      .where(eq(taskRuns.id, run.id))
      .run();

  save(run.cursor, pending.length, false);
  const started = Date.now();
  let cursor = run.cursor;
  let handled = 0;
  for (const key of pending) {
    if (handled >= MIGRATE_BATCH_FILES || Date.now() - started > MIGRATE_BATCH_MS) break;
    try {
      const local = await localDisk.stat(key);
      if (!local) {
        counts.skipped++; // deleted since the listing
      } else {
        const remote = await bucket.stat(key);
        if (remote && remote.size === local.size) counts.duplicates++;
        else {
          await bucket.put(key, { path: resolveKey(key) }, mimeForKey(key));
          counts.done++;
        }
        if (deleteLocal) await localDisk.remove(key);
      }
    } catch (err) {
      counts.failed++;
      errors.push({ item: key, message: (err as Error).message.slice(0, 500) });
    }
    cursor = key;
    handled++;
    save(cursor, pending.length - handled, false);
  }

  const left = pending.length - handled;
  if (left > 0) {
    const job = enqueue(STORAGE_MIGRATE_JOB, { runId: run.id }, { maxAttempts: 3 });
    db.update(taskRuns).set({ jobId: job.id }).where(eq(taskRuns.id, run.id)).run();
    return;
  }
  save(cursor, 0, true);
}

export function registerStorageJobs(): void {
  registerJob(STORAGE_MIGRATE_JOB, async (payload) => {
    await runStorageMigration(payload as { runId: string });
  });
}
