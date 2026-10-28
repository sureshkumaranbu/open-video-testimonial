import { aiStatus } from "./ai";
import { ocrStatus } from "./ocr";
import { emailMode, fromWarning } from "./email";
import { env } from "./env";
import { ffmpegAvailable } from "./media";
import { storageStatus } from "./storage";
import { transcriptionEnabled } from "./transcribe";

/** What optional features this server has, for the dashboard and docs links. */
export async function systemStatus() {
  const storage = await storageStatus();
  return {
    ffmpeg: await ffmpegAvailable(),
    transcription: { enabled: transcriptionEnabled(), provider: env.transcribeProvider },
    hls: env.videoHls,
    ai: aiStatus(),
    ocr: ocrStatus(),
    email: { mode: emailMode(), from: emailMode() === "off" ? null : env.smtpFrom, warning: fromWarning() },
    storage: { driver: storage.driver, bucket: storage.bucket, ok: storage.ok, error: storage.error },
  };
}

export type SystemStatus = Awaited<ReturnType<typeof systemStatus>>;
