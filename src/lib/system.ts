import { env } from "./env";
import { ffmpegAvailable } from "./media";
import { transcriptionEnabled } from "./transcribe";

/** What optional features this server has, for the dashboard and docs links. */
export async function systemStatus() {
  return {
    ffmpeg: await ffmpegAvailable(),
    transcription: { enabled: transcriptionEnabled(), provider: env.transcribeProvider },
  };
}

export type SystemStatus = Awaited<ReturnType<typeof systemStatus>>;
