import { UNSUPPORTED_VIDEO } from "@/lib/sniff";

/**
 * Everything the recorder says, in English. The step-by-step form passes its
 * locale's wording (src/lib/i18n/collect); `{…}` are filled in.
 */
export const RECORDER_LABELS = {
  recRecordWithCamera: "Record with camera",
  recIntro: "Up to {limit}. There's a 3-second countdown, and the questions stay on screen while you talk.",
  recIntroNoCamera: "This browser can't record in the page. Use your camera app or upload a video below.",
  recCantRecord: "This browser can't record here. Use your camera app or upload a video instead.",
  recCameraBlocked: "Your camera is blocked. Allow camera access in your browser, or use one of the other options below.",
  recStartFailed: "Recording failed to start. Use your camera app or upload a video instead.",
  recStoppedUnexpectedly: "Recording stopped unexpectedly. Try again, or use your camera app instead.",
  recReady: "Ready",
  recStart: "Start recording",
  recStop: "Stop · {time} left",
  recQuestionOf: "Question {n} of {total}",
  recPreviousQuestion: "Previous question",
  recNextQuestion: "Next question",
  recHideQuestions: "Hide questions",
  recShowQuestions: "Show questions",
  recSwitchCamera: "Switch camera",
  recSecondsLeft: "{n} seconds left. Recording stops automatically at {limit}.",
  recRetryUpload: "Retry upload",
  recUploaded: "Video uploaded",
  recUploading: "Uploading video… {percent}%",
  recChooseAnother: "Choose another file",
  recPlayBack: "Play it back before you send it.",
  recPreferFile: "Prefer a file you already have?",
  recRecordAgain: "Record again",
  recUseCameraApp: "Use camera app",
  recUploadFile: "Upload a video",
  recCameraPreview: "Camera preview",
  recYourRecording: "Your recording",
  recMinutes: "{n} minutes",
  recOneMinute: "1 minute",
  recSeconds: "{n} seconds",
  recMinutesSeconds: "{m} min {s} s",
  recUnsupported: UNSUPPORTED_VIDEO,
  /** Empty: the shared English wording from src/lib/sniff.ts. `{mb}` is the limit. */
  recTooLarge: "",
};
export type RecorderLabels = typeof RECORDER_LABELS;

/** "{a} and {b}" templates, filled in. */
export function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

