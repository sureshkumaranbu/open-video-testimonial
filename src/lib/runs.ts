import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/**
 * Background task runs (imports, the copy of local media to S3, onboarding
 * discovery). The job doing the work keeps one task_runs row up to date, and
 * the dashboard polls GET /api/admin/runs/[id] for its progress.
 *
 * This reads with plain SQL rather than the Drizzle table, so it works on
 * every schema version: a database without task_runs simply has no runs.
 */

/** Mirrors TASK_RUN_KINDS / TASK_RUN_STATUSES in src/db/schema.ts. */
export type RunKind = "import" | "storage-migrate" | "discover";
export type RunStatus = "previewed" | "queued" | "running" | "done" | "failed";

/** One problem the run hit. Writers store strings or `{item, message}` in `errors`. */
export type RunError = { message: string; item?: string };

/** What the dashboard shows while a run is going. Never includes the run's input or options (they may hold API keys). */
export type RunProgress = {
  id: string;
  projectId: string | null;
  kind: RunKind;
  /** Adapter id, "local->s3" or the site being searched. */
  subject: string | null;
  status: RunStatus;
  total: number;
  done: number;
  duplicates: number;
  skipped: number;
  failed: number;
  /** Share of `total` handled so far (0–100); null while the total isn't known yet. */
  percent: number | null;
  finished: boolean;
  /** The first MAX_RUN_ERRORS problems; `errorCount` has them all. */
  errors: RunError[];
  errorCount: number;
  createdAt: string;
  finishedAt: string | null;
};

export const MAX_RUN_ERRORS = 20;

type RunRow = {
  id: string;
  project_id: string | null;
  kind: RunKind;
  subject: string | null;
  status: RunStatus;
  total: number;
  done: number;
  duplicates: number;
  skipped: number;
  failed: number;
  errors: string;
  created_at: number;
  finished_at: number | null;
};

function hasRunsTable() {
  return Boolean(getDb().get(sql`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'task_runs'`));
}

function parseErrors(raw: string): RunError[] {
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.map((e): RunError => {
    if (typeof e === "string") return { message: e };
    if (e && typeof e === "object" && "message" in e) {
      const { message, item } = e as { message: unknown; item?: unknown };
      return item == null ? { message: String(message) } : { message: String(message), item: String(item) };
    }
    return { message: JSON.stringify(e) };
  });
}

export function toRunProgress(row: RunRow): RunProgress {
  const finished = row.status === "done" || row.status === "failed";
  const handled = row.done + row.duplicates + row.skipped + row.failed;
  const errors = parseErrors(row.errors);
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    subject: row.subject,
    status: row.status,
    total: row.total,
    done: row.done,
    duplicates: row.duplicates,
    skipped: row.skipped,
    failed: row.failed,
    percent: row.total > 0 ? Math.min(100, Math.round((handled / row.total) * 100)) : finished ? 100 : null,
    finished,
    errors: errors.slice(0, MAX_RUN_ERRORS),
    errorCount: errors.length,
    createdAt: new Date(row.created_at).toISOString(),
    finishedAt: row.finished_at == null ? null : new Date(row.finished_at).toISOString(),
  };
}

/** A run's progress, or null when there's no such run. */
export function getRunProgress(id: string): RunProgress | null {
  if (!hasRunsTable()) return null;
  const row = getDb().get<RunRow | undefined>(sql`
    SELECT id, project_id, kind, subject, status, total, done, duplicates, skipped, failed, errors, created_at, finished_at
    FROM task_runs WHERE id = ${id}`);
  return row ? toRunProgress(row) : null;
}
