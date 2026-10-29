import { registerJob, registerPeriodic } from "../jobs";
import { registerEventListener } from "../webhooks";
import { FORM_VIDEO_JOB, FORM_VIDEO_TRANSCRIBE_JOB, processFormVideo, transcribeFormVideo } from "./form-videos";
import { backfillHls, HLS_JOB, makeHls, refreshHls } from "./hls";
import { RENDER_JOB, runRender } from "./renders";

/** M16's jobs: renders, HLS copies and the owner's form videos. */
export function registerVideoJobs() {
  registerJob(RENDER_JOB, async (payload) => {
    await runRender((payload as { renderId: string }).renderId);
  });
  registerJob(HLS_JOB, async (payload) => {
    await makeHls((payload as { renderId: string }).renderId);
  });
  registerJob(FORM_VIDEO_JOB, async (payload, job) => {
    await processFormVideo((payload as { formVideoId: string }).formVideoId, { willRetry: job.attempts < job.maxAttempts });
  });
  registerJob(FORM_VIDEO_TRANSCRIBE_JOB, async (payload, job) => {
    await transcribeFormVideo((payload as { formVideoId: string }).formVideoId, { willRetry: job.attempts < job.maxAttempts });
  });
  // VID-06: a newly approved (or restored) testimonial gets its streaming copy.
  registerEventListener((event, ctx) => {
    if ((event === "testimonial.approved" || event === "testimonial.restored") && ctx.testimonial) {
      void refreshHls(ctx.testimonial.id).catch((err) => console.error("[video] couldn't queue an HLS copy:", err));
    }
  });
  registerPeriodic("video.hls-backfill", 60 * 60 * 1000, () => backfillHls());
}
