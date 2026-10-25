import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { normaliseCaptions, vttToText } from "./captions";
import { env } from "./env";
import { enqueue, PermanentJobError } from "./jobs";
import { extractAudio, ffmpegAvailable, probe } from "./media";
import { storage } from "./storage";
import { getTestimonial } from "./testimonials";
import { emitTestimonialEvent } from "./webhooks";

const { testimonials, answers } = schema;

/**
 * Transcripts and captions. Audio is extracted with ffmpeg (16 kHz mono WAV)
 * and handed to the configured provider:
 *   - "command": a local program such as whisper.cpp, so no audio leaves the server;
 *   - "openai":  any OpenAI-compatible /audio/transcriptions endpoint
 *                (OpenAI itself, or a self-hosted server).
 * Either way the owner can edit the transcript and captions afterwards.
 */
export const TRANSCRIBE_JOB = "media.transcribe";

export function transcriptionEnabled() {
  if (env.transcribeProvider === "command") return Boolean(env.transcribeCommand);
  if (env.transcribeProvider === "openai") return Boolean(env.transcribeApiUrl);
  return false;
}

export type TranscribeResult = { transcript: string; vtt: string | null };

/** Splits a command template like a shell would for simple quoting, without running a shell. */
export function splitCommand(template: string) {
  const args: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) args.push(m[1] ?? m[2] ?? m[3]);
  return args;
}

async function viaCommand(wav: string): Promise<TranscribeResult> {
  const outBase = wav.replace(/\.wav$/, "");
  const [bin, ...args] = splitCommand(env.transcribeCommand).map((a) =>
    a.replaceAll("{input}", wav).replaceAll("{output}", outBase),
  );
  if (!bin) throw new PermanentJobError("TRANSCRIBE_COMMAND is empty");
  await new Promise<void>((resolve, reject) => {
    execFile(bin, args, { timeout: 60 * 60 * 1000, maxBuffer: 16 * 1024 * 1024, killSignal: "SIGKILL" }, (err, _out, stderr) =>
      err ? reject(new Error(`Transcription command failed: ${String(stderr || err.message).trim().slice(-300)}`)) : resolve(),
    );
  });
  const vttFile = `${outBase}.vtt`;
  if (!fs.existsSync(vttFile)) throw new Error(`The transcription command didn't write ${path.basename(vttFile)}`);
  try {
    const vtt = normaliseCaptions(await fs.promises.readFile(vttFile, "utf8"));
    return { transcript: vttToText(vtt), vtt };
  } finally {
    await fs.promises.rm(vttFile, { force: true });
  }
}

async function viaApi(wav: string): Promise<TranscribeResult> {
  const form = new FormData();
  form.set("file", new Blob([await fs.promises.readFile(wav)], { type: "audio/wav" }), "audio.wav");
  form.set("model", env.transcribeModel);
  form.set("response_format", "vtt");
  if (env.transcribeLanguage) form.set("language", env.transcribeLanguage);
  const headers: Record<string, string> = {};
  if (env.transcribeApiKey) headers.Authorization = `Bearer ${env.transcribeApiKey}`;
  const res = await fetch(`${env.transcribeApiUrl}/audio/transcriptions`, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  const body = await res.text();
  if (!res.ok) {
    const error = new Error(`Transcription API returned ${res.status}: ${body.slice(0, 300)}`);
    // Bad credentials or a bad request won't fix themselves on retry.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new PermanentJobError(error.message);
    throw error;
  }
  if (/^\s*WEBVTT/.test(body)) {
    const vtt = normaliseCaptions(body);
    return { transcript: vttToText(vtt), vtt };
  }
  // Some servers ignore response_format and answer with JSON text only.
  try {
    const json = JSON.parse(body) as { text?: string };
    if (typeof json.text === "string") return { transcript: json.text.trim(), vtt: null };
  } catch {
    // fall through
  }
  return { transcript: body.trim(), vtt: null };
}

export async function transcribeFile(wav: string): Promise<TranscribeResult> {
  if (env.transcribeProvider === "command") return viaCommand(wav);
  if (env.transcribeProvider === "openai") return viaApi(wav);
  throw new PermanentJobError("Transcription is turned off (set TRANSCRIBE_PROVIDER)");
}

function setStatus(id: string, fields: Partial<typeof testimonials.$inferInsert>) {
  getDb().update(testimonials).set(fields).where(eq(testimonials.id, id)).run();
}

/** Queues a transcript if a provider is configured. Returns whether it did. */
export function queueTranscription(testimonialId: string) {
  if (!transcriptionEnabled()) return false;
  setStatus(testimonialId, { transcriptStatus: "queued", transcriptError: null });
  enqueue(TRANSCRIBE_JOB, { testimonialId }, { maxAttempts: 3 });
  return true;
}

/** `willRetry` keeps the status at "queued" when the job queue will try again. */
export async function transcribeTestimonial(testimonialId: string, opts: { willRetry?: boolean } = {}) {
  const row = getDb().select().from(testimonials).where(eq(testimonials.id, testimonialId)).get();
  if (!row) return;
  const key = row.videoOriginalKey ?? row.videoKey;
  if (!key) throw new PermanentJobError("This testimonial has no video");
  if (!(await ffmpegAvailable())) {
    setStatus(row.id, { transcriptStatus: "failed", transcriptError: "ffmpeg is needed to read the audio" });
    throw new PermanentJobError("ffmpeg is needed to read the audio");
  }
  setStatus(row.id, { transcriptStatus: "processing", transcriptError: null });
  await fs.promises.mkdir(env.tmpDir, { recursive: true });
  const wav = path.join(env.tmpDir, `audio-${crypto.randomUUID()}.wav`);
  try {
    // On S3 the video is downloaded only while its audio is extracted.
    await storage().withLocalFile(key, async (input) => {
      if (!(await probe(input)).hasAudio) throw new PermanentJobError("The video has no sound to transcribe");
      await extractAudio(input, wav);
    });
    const result = await transcribeFile(wav);
    if (!getDb().select({ id: testimonials.id }).from(testimonials).where(eq(testimonials.id, row.id)).get()) return;
    setStatus(row.id, {
      transcript: result.transcript || null,
      captionsVtt: result.vtt,
      transcriptStatus: "ready",
      transcriptError: null,
      updatedAt: new Date(),
    });
    emitTestimonialEvent("testimonial.transcribed", getTestimonial(row.id));
    return result;
  } catch (err) {
    const retrying = opts.willRetry && !(err instanceof PermanentJobError);
    setStatus(row.id, {
      transcriptStatus: retrying ? "queued" : "failed",
      transcriptError: (err as Error).message.slice(0, 500),
    });
    throw err;
  } finally {
    await fs.promises.rm(wav, { force: true });
  }
}

// ---------------------------------------------------------------- answers

/** Transcripts for the videos answering a form's further questions (owner-only, D13). */
export const TRANSCRIBE_ANSWER_JOB = "media.transcribe-answer";

function setAnswer(id: string, fields: Partial<typeof answers.$inferInsert>) {
  getDb().update(answers).set(fields).where(eq(answers.id, id)).run();
}

export function queueAnswerTranscription(answerId: string) {
  if (!transcriptionEnabled()) return false;
  setAnswer(answerId, { transcriptStatus: "queued", transcriptError: null });
  enqueue(TRANSCRIBE_ANSWER_JOB, { answerId }, { maxAttempts: 3 });
  return true;
}

export async function transcribeAnswer(answerId: string, opts: { willRetry?: boolean } = {}) {
  const row = getDb().select().from(answers).where(eq(answers.id, answerId)).get();
  if (!row) return;
  const key = row.videoOriginalKey ?? row.videoKey;
  if (!key) throw new PermanentJobError("This answer has no video");
  if (!(await ffmpegAvailable())) {
    setAnswer(row.id, { transcriptStatus: "failed", transcriptError: "ffmpeg is needed to read the audio" });
    throw new PermanentJobError("ffmpeg is needed to read the audio");
  }
  setAnswer(row.id, { transcriptStatus: "processing", transcriptError: null });
  await fs.promises.mkdir(env.tmpDir, { recursive: true });
  const wav = path.join(env.tmpDir, `audio-${crypto.randomUUID()}.wav`);
  try {
    await storage().withLocalFile(key, async (input) => {
      if (!(await probe(input)).hasAudio) throw new PermanentJobError("The video has no sound to transcribe");
      await extractAudio(input, wav);
    });
    const result = await transcribeFile(wav);
    if (!getDb().select({ id: answers.id }).from(answers).where(eq(answers.id, row.id)).get()) return;
    setAnswer(row.id, {
      transcript: result.transcript || null,
      captionsVtt: result.vtt,
      transcriptStatus: "ready",
      transcriptError: null,
      updatedAt: new Date(),
    });
    return result;
  } catch (err) {
    const retrying = opts.willRetry && !(err instanceof PermanentJobError);
    setAnswer(row.id, { transcriptStatus: retrying ? "queued" : "failed", transcriptError: (err as Error).message.slice(0, 500) });
    throw err;
  } finally {
    await fs.promises.rm(wav, { force: true });
  }
}
