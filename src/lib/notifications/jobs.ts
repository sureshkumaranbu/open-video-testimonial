import { registerJob, registerPeriodic } from "../jobs";
import { registerEventListener } from "../webhooks";
import { deliverChannelJob, deliverEmailJob, notifyEvent, NOTIFY_CHANNEL_JOB, NOTIFY_EMAIL_JOB, runDigests } from "./index";

/** Email and chat delivery jobs, the digest schedule and the event listener (INT-01, INT-02). */
export function registerNotificationJobs(): void {
  registerEventListener(notifyEvent);
  registerJob(NOTIFY_CHANNEL_JOB, async (payload, job) => {
    await deliverChannelJob(payload as Parameters<typeof deliverChannelJob>[0], { final: job.attempts >= job.maxAttempts });
  });
  registerJob(NOTIFY_EMAIL_JOB, async (payload) => {
    await deliverEmailJob(payload as Parameters<typeof deliverEmailJob>[0]);
  });
  registerPeriodic("notifications.digests", 15 * 60 * 1000, () => runDigests());
}
