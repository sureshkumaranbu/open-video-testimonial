import crypto from "node:crypto";
import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Job } from "@/db/schema";

const { jobs } = schema;

/**
 * A small SQLite-backed job queue. The server runs one worker loop in-process
 * (see src/instrumentation.ts), which is enough for a single self-hosted
 * instance. Jobs survive restarts because they live in the database.
 */
export type JobHandler = (payload: unknown, job: Job) => Promise<void>;

const handlers = new Map<string, JobHandler>();

/** How long a job may run before another worker may assume it crashed. */
const LOCK_MS = 15 * 60 * 1000;

export function registerJob(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export function enqueue(
  type: string,
  payload: unknown,
  opts: { runAt?: Date; maxAttempts?: number } = {},
): Job {
  const now = new Date();
  return getDb()
    .insert(jobs)
    .values({
      id: crypto.randomUUID(),
      type,
      payload: JSON.stringify(payload ?? null),
      runAt: opts.runAt ?? now,
      maxAttempts: opts.maxAttempts ?? 3,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

/** Retry delay after a failed attempt: 30 s, 2 min, 8 min… capped at 6 h. */
export function retryDelayMs(attempt: number) {
  return Math.min(30_000 * 4 ** Math.max(attempt - 1, 0), 6 * 60 * 60 * 1000);
}

/** Thrown by a handler to fail a job without retrying. */
export class PermanentJobError extends Error {}

/** Atomically claims the next due job, or returns null. */
function claimNext(now: Date): Job | null {
  const db = getDb();
  return db.transaction((tx) => {
    const job = tx
      .select()
      .from(jobs)
      .where(
        or(
          and(eq(jobs.status, "queued"), lte(jobs.runAt, now)),
          and(eq(jobs.status, "running"), lte(jobs.lockedUntil, now)),
        ),
      )
      // rowid breaks ties, so jobs queued in the same millisecond run in order
      // (a testimonial's "created" webhook before its "approved" one).
      .orderBy(asc(jobs.runAt), sql`rowid`)
      .limit(1)
      .get();
    if (!job) return null;
    return tx
      .update(jobs)
      .set({
        status: "running",
        attempts: job.attempts + 1,
        lockedUntil: new Date(now.getTime() + LOCK_MS),
        updatedAt: now,
      })
      .where(eq(jobs.id, job.id))
      .returning()
      .get();
  });
}

async function runOne(job: Job, now: () => Date) {
  const db = getDb();
  const handler = handlers.get(job.type);
  try {
    if (!handler) throw new PermanentJobError(`No handler for job type "${job.type}"`);
    await handler(JSON.parse(job.payload), job);
    db.update(jobs)
      .set({ status: "done", lockedUntil: null, lastError: null, updatedAt: now() })
      .where(eq(jobs.id, job.id))
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permanent = err instanceof PermanentJobError || job.attempts >= job.maxAttempts;
    db.update(jobs)
      .set({
        status: permanent ? "failed" : "queued",
        runAt: new Date(now().getTime() + retryDelayMs(job.attempts)),
        lockedUntil: null,
        lastError: message.slice(0, 2000),
        updatedAt: now(),
      })
      .where(eq(jobs.id, job.id))
      .run();
    if (permanent) console.error(`[jobs] ${job.type} ${job.id} failed: ${message}`);
  }
}

/** Runs every job that is due, one at a time. Returns how many ran. */
export async function runDueJobs(opts: { now?: () => Date; limit?: number } = {}) {
  const now = opts.now ?? (() => new Date());
  const limit = opts.limit ?? 100;
  let ran = 0;
  while (ran < limit) {
    const job = claimNext(now());
    if (!job) break;
    await runOne(job, now);
    ran++;
  }
  return ran;
}

export function getJob(id: string) {
  return getDb().select().from(jobs).where(eq(jobs.id, id)).get() ?? null;
}

// ------------------------------------------------------------- scheduling

type Periodic = { name: string; everyMs: number; run: () => unknown };
const periodic: Periodic[] = [];

/** Registers maintenance work (cleanup, reminders) that the worker runs on a timer. */
export function registerPeriodic(name: string, everyMs: number, run: Periodic["run"]) {
  if (!periodic.some((p) => p.name === name)) periodic.push({ name, everyMs, run });
}

export async function runPeriodicTasks() {
  for (const task of periodic) {
    try {
      await task.run();
    } catch (err) {
      console.error(`[jobs] periodic task ${task.name} failed:`, err);
    }
  }
}

let started = false;

/** Starts the polling loop. Safe to call more than once. */
export function startWorker(pollMs: number) {
  if (started) return;
  started = true;
  let busy = false;
  const lastRun = new Map<string, number>();
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = Date.now();
      for (const task of periodic) {
        if (now - (lastRun.get(task.name) ?? 0) >= task.everyMs) {
          lastRun.set(task.name, now);
          try {
            await task.run();
          } catch (err) {
            console.error(`[jobs] periodic task ${task.name} failed:`, err);
          }
        }
      }
      await runDueJobs();
    } catch (err) {
      console.error("[jobs] worker tick failed:", err);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, pollMs);
  timer.unref();
  void tick();
}
