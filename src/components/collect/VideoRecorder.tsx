"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { pickMimeType, type UploadState } from "@/lib/resumable-upload";
import { isVideoMime, sniffMime, tooLarge } from "@/lib/sniff";
import { createAnswerUpload, type AnswerUploadController, type RecordedVideo } from "./answer-uploads";
import { fill, RECORDER_LABELS, type RecorderLabels } from "./recorder-labels";

export type { RecordedVideo } from "./answer-uploads";
export { RECORDER_LABELS, type RecorderLabels } from "./recorder-labels";

type State = "idle" | "previewing" | "countdown" | "recording" | "recorded";
type Facing = "user" | "environment";

const COUNTDOWN = 3;
const WARN_AT = 10;


type Props = {
  slug: string;
  questions: string[];
  maxSeconds: number;
  /** The server's size limit for a video, so a picked file that's too big is refused before uploading. */
  maxBytes: number;
  onChange: (video: RecordedVideo | null) => void;
  /** Where uploads start; defaults to the project's collection endpoint. */
  createUrl?: string;
  /**
   * Who holds the take and its upload. Pass one to keep a recording when the
   * recorder leaves the page (the step-by-step form); without one the recorder
   * owns its upload, as on the classic page.
   */
  upload?: AnswerUploadController;
  /** Abort the upload when the recorder unmounts. Default true (the classic page); the step form passes false. */
  abortOnUnmount?: boolean;
  labels?: Partial<RecorderLabels>;
};

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function describeLimit(seconds: number, l: RecorderLabels) {
  if (seconds % 60 === 0) return seconds === 60 ? l.recOneMinute : fill(l.recMinutes, { n: seconds / 60 });
  return seconds < 60 ? fill(l.recSeconds, { n: seconds }) : fill(l.recMinutesSeconds, { m: Math.floor(seconds / 60), s: seconds % 60 });
}

/**
 * The "play it back" player. A recording from MediaRecorder (WebM) has no
 * length in its header, so the browser reports Infinity and the timeline
 * can't seek. Seeking far past the end makes it work the length out; then
 * jump back to the start.
 */
function Playback({ src, label }: { src: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const measured = () => {
      if (!Number.isFinite(video.duration)) return;
      video.removeEventListener("durationchange", measured);
      video.currentTime = 0;
    };
    const measure = () => {
      if (video.duration !== Infinity) return;
      video.addEventListener("durationchange", measured);
      video.currentTime = Number.MAX_SAFE_INTEGER;
    };
    video.addEventListener("loadedmetadata", measure);
    if (video.readyState >= 1) measure();
    return () => {
      video.removeEventListener("loadedmetadata", measure);
      video.removeEventListener("durationchange", measured);
    };
  }, [src]);
  return <video ref={ref} src={src} controls playsInline preload="metadata" aria-label={label} />;
}

/**
 * Records from the camera with MediaRecorder and uploads while recording, or
 * takes a file (including one from the phone's own camera app).
 */
export function VideoRecorder({
  slug,
  questions,
  maxSeconds,
  maxBytes,
  onChange,
  createUrl,
  upload,
  abortOnUnmount = true,
  labels,
}: Props) {
  const l: RecorderLabels = { ...RECORDER_LABELS, ...labels };
  // The controller outlives this recorder when one is passed in; otherwise it's ours alone.
  const [ctrl] = useState<AnswerUploadController>(
    () => upload ?? createAnswerUpload({ createUrl: createUrl ?? `/api/projects/${slug}/uploads` }),
  );
  const kept = ctrl.take;
  const [state, setState] = useState<State>(kept ? "recorded" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [count, setCount] = useState(COUNTDOWN);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(() => (kept ? URL.createObjectURL(kept.blob) : null));
  const [question, setQuestion] = useState(0);
  const [showPrompts, setShowPrompts] = useState(true);
  const [facing, setFacing] = useState<Facing>("user");
  const [canSwitch, setCanSwitch] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [touch, setTouch] = useState(false);
  const [canRecord, setCanRecord] = useState(true);
  const [progress, setProgress] = useState<UploadState | null>(kept ? ctrl.state : null);
  /** Why the last file was refused (too large, not a video): pick another one. */
  const [rejected, setRejected] = useState<string | null>(null);
  const liveRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** The camera stream the preview shows (state, so the preview updates when it changes). */
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setTouch(window.matchMedia("(pointer: coarse)").matches);
    setCanRecord(Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined");
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLiveStream(null);
  }

  function clearTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  // Progress (and a refusal of the file) arrives through the controller, also
  // for an upload this recorder started before it last left the page.
  useEffect(
    () =>
      ctrl.subscribe(() => {
        const s = ctrl.state;
        setProgress(s);
        if (s?.fatal && s.error) rejectFile(s.error);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctrl],
  );

  useEffect(
    () => () => {
      // A recording still running is finished and kept (its onstop saves the take).
      if (!abortOnUnmount && recorderRef.current?.state === "recording") recorderRef.current.stop();
      stopStream();
      clearTimer();
      if (abortOnUnmount) ctrl.discard();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => () => {
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  }, [playbackUrl]);

  // Show the camera in the preview once the <video> is on the page, and again
  // after switching cameras (same element, new stream).
  const live = state === "previewing" || state === "countdown" || state === "recording";
  useEffect(() => {
    const video = liveRef.current;
    if (!live || !video || !liveStream) return;
    if (video.srcObject !== liveStream) video.srcObject = liveStream;
    void video.play().catch(() => undefined);
  }, [live, liveStream]);

  function newUpload(size?: number) {
    const started = ctrl.begin(size);
    setProgress(started.state);
    return started;
  }

  /** The file can't be used at all: drop it and ask for another one. */
  function rejectFile(message: string) {
    ctrl.discard();
    setProgress(null);
    setResult(null);
    setState("idle");
    setRejected(message);
  }

  /** Keeps the finished take with the controller (or clears it), and tells the form. */
  function setResult(blob: Blob | null) {
    setPlaybackUrl(blob ? URL.createObjectURL(blob) : null);
    onChange(blob ? ctrl.keep(blob) : null);
  }

  async function openCamera(nextFacing: Facing = facing) {
    setError(null);
    setRejected(null);
    if (!canRecord) {
      setError(l.recCantRecord);
      return;
    }
    stopStream();
    const tall = window.innerHeight > window.innerWidth;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: nextFacing,
          width: { ideal: tall ? 720 : 1280 },
          height: { ideal: tall ? 1280 : 720 },
        },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      setLiveStream(stream);
      const settings = stream.getVideoTracks()[0]?.getSettings();
      setPortrait(Boolean(settings?.width && settings?.height && settings.height > settings.width) || tall);
      setFacing(nextFacing);
      setState("previewing");
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => setCanSwitch(devices.filter((d) => d.kind === "videoinput").length > 1))
        .catch(() => undefined);
    } catch {
      setError(l.recCameraBlocked);
    }
  }

  function countdownThenRecord() {
    setCount(COUNTDOWN);
    setState("countdown");
    let left = COUNTDOWN;
    clearTimer();
    timerRef.current = setInterval(() => {
      left -= 1;
      setCount(left);
      if (left <= 0) {
        clearTimer();
        startRecording();
      }
    }, 1000);
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t), navigator.userAgent);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      setError(l.recStartFailed);
      setState("previewing");
      return;
    }
    const take = newUpload();
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      chunks.push(e.data);
      take.append(e.data);
    };
    recorder.onerror = () => {
      setError(l.recStoppedUnexpectedly);
    };
    recorder.onstop = () => {
      clearTimer();
      stopStream();
      const type = (recorder.mimeType || mimeType || "video/webm").split(";")[0];
      const blob = new Blob(chunks, { type });
      void take.finish().catch(() => undefined); // errors surface through onProgress
      setResult(blob);
      setState("recorded");
    };
    recorderRef.current = recorder;
    recorder.start(1000);
    setSeconds(0);
    setQuestion(0);
    setState("recording");
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        // Stop cleanly at the limit rather than letting the browser cut out.
        if (s + 1 >= maxSeconds && recorder.state === "recording") recorder.stop();
        return s + 1;
      });
    }, 1000);
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function reset() {
    ctrl.discard();
    setProgress(null);
    setResult(null);
    setError(null);
    setRejected(null);
    setState("idle");
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    stopStream();
    clearTimer();
    setError(null);
    setRejected(null);
    // Say so straight away if it's too big or isn't a video at all, rather
    // than after uploading it (the server checks too).
    if (file.size > maxBytes) {
      rejectFile(l.recTooLarge ? fill(l.recTooLarge, { mb: Math.round(maxBytes / 1024 / 1024) }) : tooLarge(maxBytes));
      return;
    }
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!isVideoMime(sniffMime(head))) {
      rejectFile(l.recUnsupported);
      return;
    }
    const picked = newUpload(file.size);
    picked.append(file);
    void picked.finish().catch(() => undefined);
    setResult(file);
    setState("recorded");
  }

  const left = maxSeconds - seconds;
  const percent = progress && progress.total ? Math.floor((progress.sent / progress.total) * 100) : 0;

  return (
    <div className="recorder" data-testid="video-recorder" data-state={state}>
      {state === "recorded" && playbackUrl ? (
        <div className="recorder-playback">
          <Playback src={playbackUrl} label={l.recYourRecording} />
        </div>
      ) : (
        <div className="recorder-stage" data-portrait={portrait && live}>
          {live && <video ref={liveRef} muted playsInline aria-label={l.recCameraPreview} data-facing={facing} />}
          {state === "recording" && (
            <span className="rec-pill live" data-warn={left <= WARN_AT}>
              REC {clock(seconds)}
            </span>
          )}
          {state === "previewing" && <span className="rec-pill">{l.recReady}</span>}
          {state === "countdown" && (
            <span className="countdown" data-testid="countdown" aria-live="assertive" key={count}>
              {count}
            </span>
          )}
          {live && showPrompts && questions.length > 0 && (
            <div className="prompt-overlay" data-testid="prompt-overlay">
              <span className="prompt-step">
                {fill(l.recQuestionOf, { n: question + 1, total: questions.length })}
              </span>
              <p aria-live="polite">{questions[question]}</p>
              {questions.length > 1 && (
                <div className="prompt-nav">
                  <button
                    type="button"
                    className="small"
                    onClick={() => setQuestion((q) => (q - 1 + questions.length) % questions.length)}
                    aria-label={l.recPreviousQuestion}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="small"
                    onClick={() => setQuestion((q) => (q + 1) % questions.length)}
                  >
                    {l.recNextQuestion}
                  </button>
                </div>
              )}
            </div>
          )}
          {state === "idle" && (
            <div className="recorder-empty">
              <button type="button" className="rec-button" onClick={() => openCamera()} disabled={!canRecord}>
                {l.recRecordWithCamera}
              </button>
              <p>
                {canRecord ? fill(l.recIntro, { limit: describeLimit(maxSeconds, l) }) : l.recIntroNoCamera}
              </p>
            </div>
          )}
          {live && (
            <div className="recorder-controls">
              {state === "previewing" && (
                <button type="button" className="rec-button" onClick={countdownThenRecord}>
                  {l.recStart}
                </button>
              )}
              {state === "recording" && (
                <button type="button" className="rec-button stop" onClick={stopRecording}>
                  {fill(l.recStop, { time: clock(Math.max(left, 0)) })}
                </button>
              )}
            </div>
          )}
          {live && (
            <div className="recorder-tools">
              {questions.length > 0 && (
                <button
                  type="button"
                  className="small"
                  aria-pressed={showPrompts}
                  onClick={() => setShowPrompts((v) => !v)}
                >
                  {showPrompts ? l.recHideQuestions : l.recShowQuestions}
                </button>
              )}
              {canSwitch && state === "previewing" && (
                <button
                  type="button"
                  className="small"
                  onClick={() => openCamera(facing === "user" ? "environment" : "user")}
                >
                  {l.recSwitchCamera}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {state === "recording" && left <= WARN_AT && (
        <p className="muted small" role="status">
          {fill(l.recSecondsLeft, { n: left, limit: describeLimit(maxSeconds, l) })}
        </p>
      )}

      {state === "recorded" && progress && (
        <div className="upload-status" data-testid="upload-status" data-done={progress.done} role="status">
          {progress.error ? (
            <>
              <span className="error-text">{progress.error}</span>
              <button type="button" className="secondary small" onClick={() => ctrl.take?.upload.retry()}>
                {l.recRetryUpload}
              </button>
            </>
          ) : progress.done ? (
            <span>
              <Icon name="check" /> {l.recUploaded}
            </span>
          ) : (
            <>
              <span>{fill(l.recUploading, { percent })}</span>
              <span className="upload-meter" aria-hidden>
                <span style={{ transform: `scaleX(${percent / 100})` }} />
              </span>
            </>
          )}
        </div>
      )}

      {rejected && (
        <div className="upload-status rejected" data-testid="upload-rejected" role="alert">
          <span className="error-text">{rejected}</span>
          <label className="button secondary small" style={{ flexDirection: "row" }}>
            <Icon name="upload" />
            {l.recChooseAnother}
            <input type="file" accept="video/*" onChange={onFile} data-testid="video-file-again" style={{ display: "none" }} />
          </label>
        </div>
      )}

      <div className="recorder-bar">
        <span className="muted small">
          {state === "recorded" ? l.recPlayBack : l.recPreferFile}
        </span>
        <div className="row" style={{ gap: "var(--space-2)" }}>
          {state === "recorded" && (
            <button type="button" className="secondary small" onClick={reset}>
              <Icon name="undo" />
              {l.recRecordAgain}
            </button>
          )}
          {state !== "recording" && state !== "countdown" && (
            <>
              {(touch || !canRecord) && (
                <label className="button secondary small" style={{ flexDirection: "row" }}>
                  <Icon name="video" />
                  {l.recUseCameraApp}
                  <input
                    type="file"
                    accept="video/*"
                    capture="user"
                    onChange={onFile}
                    data-testid="video-capture"
                    style={{ display: "none" }}
                  />
                </label>
              )}
              <label className="button secondary small" style={{ flexDirection: "row" }}>
                <Icon name="upload" />
                {l.recUploadFile}
                <input
                  type="file"
                  accept="video/*"
                  onChange={onFile}
                  data-testid="video-file"
                  style={{ display: "none" }}
                />
              </label>
            </>
          )}
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
