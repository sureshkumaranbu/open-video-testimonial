import { env } from "./env";
import { registerJob, registerPeriodic, startWorker } from "./jobs";
import { processVideo, PROCESS_VIDEO_JOB, queueUnprocessedVideos } from "./media";
import { getTestimonial } from "./testimonials";
import { queueTranscription, TRANSCRIBE_JOB, transcribeTestimonial } from "./transcribe";
import { cleanupExpiredUploads } from "./uploads";

/** Wires every background job type and periodic task to its handler. */
export function registerJobs() {
  registerJob(PROCESS_VIDEO_JOB, async (payload, job) => {
    const { testimonialId } = payload as { testimonialId: string };
    await processVideo(testimonialId, { willRetry: job.attempts < job.maxAttempts });
    // Transcribe new videos once they're converted (if a provider is set up).
    const t = getTestimonial(testimonialId);
    if (t?.mediaStatus === "ready" && t.transcriptStatus === "none") queueTranscription(testimonialId);
  });
  registerJob(TRANSCRIBE_JOB, async (payload, job) => {
    const { testimonialId } = payload as { testimonialId: string };
    await transcribeTestimonial(testimonialId, { willRetry: job.attempts < job.maxAttempts });
  });
  registerPeriodic("uploads.cleanup", 60 * 60 * 1000, () => cleanupExpiredUploads());
  registerPeriodic("media.backfill", 24 * 60 * 60 * 1000, () => queueUnprocessedVideos());
}

export function startBackgroundWorker() {
  registerJobs();
  if (env.workerEnabled) startWorker(env.jobsPollMs);
}
