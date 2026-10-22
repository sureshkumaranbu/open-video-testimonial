import fs from "node:fs";
import { fetchImportedMedia, FETCH_MEDIA_JOB } from "./csv-import";
import { env } from "./env";
import { importArchive, IMPORT_JOB } from "./portability";
import { registerJob, registerPeriodic, startWorker } from "./jobs";
import { processVideo, PROCESS_VIDEO_JOB, queueUnprocessedVideos } from "./media";
import { queueDueReminders, SEND_EMAIL_JOB, sendRequestEmail, sendThankYou, THANK_YOU_JOB } from "./requests";
import { getTestimonial } from "./testimonials";
import { queueTranscription, TRANSCRIBE_JOB, transcribeTestimonial } from "./transcribe";
import { cleanupExpiredUploads } from "./uploads";
import { deliver, DELIVER_JOB } from "./webhooks";

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
  registerJob(SEND_EMAIL_JOB, async (payload, job) => {
    await sendRequestEmail(payload as Parameters<typeof sendRequestEmail>[0], job.attempts >= job.maxAttempts);
  });
  registerJob(THANK_YOU_JOB, async (payload) => {
    await sendThankYou(payload as Parameters<typeof sendThankYou>[0]);
  });
  registerJob(DELIVER_JOB, async (payload, job) => {
    await deliver((payload as { deliveryId: string }).deliveryId, job.attempts >= job.maxAttempts);
  });
  registerJob(IMPORT_JOB, async (payload) => {
    const { zipPath, projectId } = payload as { zipPath: string; projectId: string };
    try {
      await importArchive(zipPath, projectId);
    } finally {
      await fs.promises.rm(zipPath, { force: true });
    }
  });
  registerJob(FETCH_MEDIA_JOB, async (payload) => {
    await fetchImportedMedia(payload as Parameters<typeof fetchImportedMedia>[0]);
  });
  registerPeriodic("requests.reminders", 5 * 60 * 1000, () => queueDueReminders());
  registerPeriodic("uploads.cleanup", 60 * 60 * 1000, () => cleanupExpiredUploads());
  registerPeriodic("media.backfill", 24 * 60 * 60 * 1000, () => queueUnprocessedVideos());
}

export function startBackgroundWorker() {
  registerJobs();
  if (env.workerEnabled) startWorker(env.jobsPollMs);
}
