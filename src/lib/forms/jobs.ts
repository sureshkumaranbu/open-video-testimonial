import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { maybeAutoApprove } from "@/lib/auto-approve";
import { registerJob } from "@/lib/jobs";
import { processVideoTarget, PROCESS_ANSWER_VIDEO_JOB } from "@/lib/media";
import { queueAnswerTranscription, TRANSCRIBE_ANSWER_JOB, transcribeAnswer } from "@/lib/transcribe";

/**
 * Background work for multi-question forms: converting the videos that
 * answer questions 2..N, transcribing them, and checking auto-approve again
 * once the last of a submission's videos is ready.
 */
export function registerFormJobs(): void {
  registerJob(PROCESS_ANSWER_VIDEO_JOB, async (payload, job) => {
    const { answerId, autoApprove } = payload as { answerId: string; autoApprove?: boolean };
    await processVideoTarget({ answerId }, { willRetry: job.attempts < job.maxAttempts });
    const { answers } = schema;
    const a = getDb().select().from(answers).where(eq(answers.id, answerId)).get();
    if (a?.mediaStatus === "ready" && a.transcriptStatus === "none") queueAnswerTranscription(answerId);
    if (a?.mediaStatus === "ready" && autoApprove) maybeAutoApprove(a.testimonialId);
  });
  registerJob(TRANSCRIBE_ANSWER_JOB, async (payload, job) => {
    const { answerId } = payload as { answerId: string };
    await transcribeAnswer(answerId, { willRetry: job.attempts < job.maxAttempts });
  });
}
