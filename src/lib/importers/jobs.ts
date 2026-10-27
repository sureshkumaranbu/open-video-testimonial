import { registerJob, registerPeriodic } from "../jobs";
import { cleanupStalePreviews, IMPORT_PLATFORM_JOB, runImportJob } from "./run";
import { registerSyncJobs } from "./sync";

/** The review-site import job (`import.platform`): one chunk per run, re-enqueued until done; and the auto-sync schedule. */
export function registerImportJobs(): void {
  registerJob(IMPORT_PLATFORM_JOB, async (payload, job) => {
    await runImportJob(payload as { runId: string }, { final: job.attempts >= job.maxAttempts });
  });
  registerPeriodic("imports.cleanup", 60 * 60 * 1000, () => cleanupStalePreviews());
  // IMP-02: hourly, start every synced source that's due.
  registerSyncJobs();
}
