import { env } from "./env";
import { registerJob, registerPeriodic, startWorker } from "./jobs";
import { processVideo, PROCESS_VIDEO_JOB, queueUnprocessedVideos } from "./media";
import { cleanupExpiredUploads } from "./uploads";

/** Wires every background job type and periodic task to its handler. */
export function registerJobs() {
  registerJob(PROCESS_VIDEO_JOB, async (payload) => {
    await processVideo((payload as { testimonialId: string }).testimonialId);
  });
  registerPeriodic("uploads.cleanup", 60 * 60 * 1000, () => cleanupExpiredUploads());
  registerPeriodic("media.backfill", 24 * 60 * 60 * 1000, () => queueUnprocessedVideos());
}

export function startBackgroundWorker() {
  registerJobs();
  if (env.workerEnabled) startWorker(env.jobsPollMs);
}
