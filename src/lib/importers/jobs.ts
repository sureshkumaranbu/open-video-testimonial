import { registerJob } from "../jobs";
import { IMPORT_PLATFORM_JOB, runImportJob } from "./run";

/** The review-site import job (`import.platform`): one chunk per run, re-enqueued until done. */
export function registerImportJobs(): void {
  registerJob(IMPORT_PLATFORM_JOB, async (payload, job) => {
    await runImportJob(payload as { runId: string }, { final: job.attempts >= job.maxAttempts });
  });
}
