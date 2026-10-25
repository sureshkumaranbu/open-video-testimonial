/**
 * Copies local media to S3 as a background task run (TEAM-05), filled in by
 * WP1.6. Until then nothing enqueues the job, and this registers no handler.
 */
export const STORAGE_MIGRATE_JOB = "storage.migrate";

/** Idempotent: HEAD before PUT; local copies are kept unless asked. */
export async function runStorageMigration(p: { runId: string }): Promise<void> {
  throw new Error("not implemented: runStorageMigration");
}

export function registerStorageJobs(): void {}
