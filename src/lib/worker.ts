import fs from "node:fs";
import { registerAnalyticsJobs } from "./analytics";
import { registerAuditJobs } from "./audit";
import { registerTriggerJobs } from "./campaign-triggers";
import { registerOAuthJobs } from "./oauth";
import { registerCustomerJobs } from "./customer-records";
import { registerTranslationJobs } from "./translations";
import { registerEmbeddingJobs } from "./embeddings";
import { maybeAutoApprove } from "./auto-approve";
import { fetchImportedMedia, FETCH_MEDIA_JOB } from "./csv-import";
import { env } from "./env";
import { registerFormJobs } from "./forms/jobs";
import { registerImportJobs } from "./importers/jobs";
import { importArchive, IMPORT_JOB } from "./portability";
import { registerJob, registerPeriodic, startWorker } from "./jobs";
import { registerMaintenanceJobs } from "./maintenance";
import { processVideo, PROCESS_VIDEO_JOB, queueUnprocessedVideos } from "./media";
import { queueDueReminders, SEND_EMAIL_JOB, sendRequestEmail, sendThankYou, THANK_YOU_JOB } from "./requests";
import { getTestimonial } from "./testimonials";
import { queueTranscription, TRANSCRIBE_JOB, transcribeTestimonial } from "./transcribe";
import { cleanupExpiredUploads } from "./uploads";
import { cleanupLoginTokens } from "./login-links";
import { registerNotificationJobs } from "./notifications/jobs";
import { registerOnboardingJobs } from "./onboarding";
import { registerStorageJobs } from "./storage-migrate";
import { refreshHls } from "./video/hls";
import { registerVideoJobs } from "./video/jobs";
import { deliver, DELIVER_JOB } from "./webhooks";

/** Wires every background job type and periodic task to its handler. */
export function registerJobs() {
  registerJob(PROCESS_VIDEO_JOB, async (payload, job) => {
    const { testimonialId, autoApprove } = payload as { testimonialId: string; autoApprove?: boolean };
    await processVideo(testimonialId, { willRetry: job.attempts < job.maxAttempts });
    // Transcribe new videos once they're converted (if a provider is set up).
    const t = getTestimonial(testimonialId);
    if (t?.mediaStatus === "ready" && t.transcriptStatus === "none") queueTranscription(testimonialId);
    if (t?.mediaStatus === "ready" && autoApprove) maybeAutoApprove(testimonialId);
    // VID-06: a new cut or file needs a new HLS copy (and the old one goes).
    if (t) await refreshHls(testimonialId);
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
  registerPeriodic("login-links.cleanup", 60 * 60 * 1000, () => cleanupLoginTokens());
  // Hourly: converts older videos, and ones uploaded while ffmpeg was missing.
  registerPeriodic("media.backfill", 60 * 60 * 1000, () => queueUnprocessedVideos());
  // Phase 1 areas register their own jobs and periodic tasks, so this file stays as it is.
  registerMaintenanceJobs();
  registerStorageJobs();
  registerFormJobs();
  registerImportJobs();
  registerNotificationJobs();
  registerOnboardingJobs();
  registerAnalyticsJobs();
  registerCustomerJobs();
  registerTranslationJobs();
  registerEmbeddingJobs();
  registerAuditJobs();
  registerTriggerJobs();
  registerOAuthJobs();
  registerVideoJobs();
}

export function startBackgroundWorker() {
  registerJobs();
  if (env.workerEnabled) startWorker(env.jobsPollMs);
}
