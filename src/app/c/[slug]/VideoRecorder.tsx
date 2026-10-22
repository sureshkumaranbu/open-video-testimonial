"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { pickMimeType, ResumableUpload, type UploadState } from "@/lib/resumable-upload";

type State = "idle" | "previewing" | "countdown" | "recording" | "recorded";
type Facing = "user" | "environment";

export type RecordedVideo = { blob: Blob; upload: ResumableUpload };

const COUNTDOWN = 3;
const WARN_AT = 10;

type Props = {
  slug: string;
  questions: string[];
  maxSeconds: number;
  onChange: (video: RecordedVideo | null) => void;
};

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function describeLimit(seconds: number) {
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? "" : "s"}`;
  return seconds < 60 ? `${seconds} seconds` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/**
 * Records from the camera with MediaRecorder and uploads while recording, or
 * takes a file (including one from the phone's own camera app).
 */
export function VideoRecorder({ slug, questions, maxSeconds, onChange }: Props) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [count, setCount] = useState(COUNTDOWN);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [question, setQuestion] = useState(0);
  const [showPrompts, setShowPrompts] = useState(true);
  const [facing, setFacing] = useState<Facing>("user");
  const [canSwitch, setCanSwitch] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [touch, setTouch] = useState(false);
  const [canRecord, setCanRecord] = useState(true);
  const [progress, setProgress] = useState<UploadState | null>(null);
  const liveRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const uploadRef = useRef<ResumableUpload | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setTouch(window.matchMedia("(pointer: coarse)").matches);
    setCanRecord(Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined");
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function clearTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  useEffect(
    () => () => {
      stopStream();
      clearTimer();
      void uploadRef.current?.abort();
    },
    [],
  );

  useEffect(() => () => {
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  }, [playbackUrl]);

  function newUpload() {
    void uploadRef.current?.abort();
    const upload = new ResumableUpload({
      createUrl: `/api/projects/${slug}/uploads`,
      onProgress: setProgress,
    });
    uploadRef.current = upload;
    setProgress(upload.state);
    return upload;
  }

  function setResult(blob: Blob | null, upload: ResumableUpload | null) {
    setPlaybackUrl(blob ? URL.createObjectURL(blob) : null);
    onChange(blob && upload ? { blob, upload } : null);
  }

  async function openCamera(nextFacing: Facing = facing) {
    setError(null);
    if (!canRecord) {
      setError("This browser can't record here. Use your camera app or upload a video instead.");
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
      const settings = stream.getVideoTracks()[0]?.getSettings();
      setPortrait(Boolean(settings?.width && settings?.height && settings.height > settings.width) || tall);
      setFacing(nextFacing);
      setState("previewing");
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => setCanSwitch(devices.filter((d) => d.kind === "videoinput").length > 1))
        .catch(() => undefined);
      requestAnimationFrame(() => {
        if (liveRef.current) {
          liveRef.current.srcObject = stream;
          void liveRef.current.play().catch(() => undefined);
        }
      });
    } catch {
      setError("Your camera is blocked. Allow camera access in your browser, or use one of the other options below.");
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
      setError("Recording failed to start. Use your camera app or upload a video instead.");
      setState("previewing");
      return;
    }
    const upload = newUpload();
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      chunks.push(e.data);
      upload.append(e.data);
    };
    recorder.onerror = () => {
      setError("Recording stopped unexpectedly. Try again, or use your camera app instead.");
    };
    recorder.onstop = () => {
      clearTimer();
      stopStream();
      const type = (recorder.mimeType || mimeType || "video/webm").split(";")[0];
      const blob = new Blob(chunks, { type });
      void upload.finish().catch(() => undefined); // errors surface through onProgress
      setResult(blob, upload);
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
    void uploadRef.current?.abort();
    uploadRef.current = null;
    setProgress(null);
    setResult(null, null);
    setError(null);
    setState("idle");
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    stopStream();
    clearTimer();
    setError(null);
    const upload = newUpload();
    upload.append(file);
    void upload.finish().catch(() => undefined);
    setResult(file, upload);
    setState("recorded");
  }

  const live = state === "previewing" || state === "countdown" || state === "recording";
  const left = maxSeconds - seconds;
  const percent = progress && progress.total ? Math.floor((progress.sent / progress.total) * 100) : 0;

  return (
    <div className="recorder" data-testid="video-recorder" data-state={state}>
      {state === "recorded" && playbackUrl ? (
        <div className="recorder-playback">
          <video src={playbackUrl} controls playsInline aria-label="Your recording" />
        </div>
      ) : (
        <div className="recorder-stage" data-portrait={portrait && live}>
          {live && <video ref={liveRef} muted playsInline aria-label="Camera preview" data-facing={facing} />}
          {state === "recording" && (
            <span className="rec-pill live" data-warn={left <= WARN_AT}>
              REC {clock(seconds)}
            </span>
          )}
          {state === "previewing" && <span className="rec-pill">Ready</span>}
          {state === "countdown" && (
            <span className="countdown" data-testid="countdown" aria-live="assertive" key={count}>
              {count}
            </span>
          )}
          {live && showPrompts && questions.length > 0 && (
            <div className="prompt-overlay" data-testid="prompt-overlay">
              <span className="prompt-step">
                Question {question + 1} of {questions.length}
              </span>
              <p aria-live="polite">{questions[question]}</p>
              {questions.length > 1 && (
                <div className="prompt-nav">
                  <button
                    type="button"
                    className="small"
                    onClick={() => setQuestion((q) => (q - 1 + questions.length) % questions.length)}
                    aria-label="Previous question"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="small"
                    onClick={() => setQuestion((q) => (q + 1) % questions.length)}
                  >
                    Next question
                  </button>
                </div>
              )}
            </div>
          )}
          {state === "idle" && (
            <div className="recorder-empty">
              <button type="button" className="rec-button" onClick={() => openCamera()} disabled={!canRecord}>
                Record with camera
              </button>
              <p>
                {canRecord
                  ? `Up to ${describeLimit(maxSeconds)}. There's a 3-second countdown, and the questions stay on screen while you talk.`
                  : "This browser can't record in the page. Use your camera app or upload a video below."}
              </p>
            </div>
          )}
          {live && (
            <div className="recorder-controls">
              {state === "previewing" && (
                <button type="button" className="rec-button" onClick={countdownThenRecord}>
                  Start recording
                </button>
              )}
              {state === "recording" && (
                <button type="button" className="rec-button stop" onClick={stopRecording}>
                  Stop · {clock(Math.max(left, 0))} left
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
                  {showPrompts ? "Hide questions" : "Show questions"}
                </button>
              )}
              {canSwitch && state === "previewing" && (
                <button
                  type="button"
                  className="small"
                  onClick={() => openCamera(facing === "user" ? "environment" : "user")}
                >
                  Switch camera
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {state === "recording" && left <= WARN_AT && (
        <p className="muted small" role="status">
          {left} seconds left. Recording stops automatically at {describeLimit(maxSeconds)}.
        </p>
      )}

      {state === "recorded" && progress && (
        <div className="upload-status" data-testid="upload-status" data-done={progress.done} role="status">
          {progress.error ? (
            <>
              <span className="error-text">{progress.error}</span>
              <button type="button" className="secondary small" onClick={() => uploadRef.current?.retry()}>
                Retry upload
              </button>
            </>
          ) : progress.done ? (
            <span>
              <Icon name="check" /> Video uploaded
            </span>
          ) : (
            <>
              <span>Uploading video… {percent}%</span>
              <span className="upload-meter" aria-hidden>
                <span style={{ transform: `scaleX(${percent / 100})` }} />
              </span>
            </>
          )}
        </div>
      )}

      <div className="recorder-bar">
        <span className="muted small">
          {state === "recorded" ? "Play it back before you send it." : "Prefer a file you already have?"}
        </span>
        <div className="row" style={{ gap: "var(--space-2)" }}>
          {state === "recorded" && (
            <button type="button" className="secondary small" onClick={reset}>
              <Icon name="undo" />
              Record again
            </button>
          )}
          {state !== "recording" && state !== "countdown" && (
            <>
              {(touch || !canRecord) && (
                <label className="button secondary small" style={{ flexDirection: "row" }}>
                  <Icon name="video" />
                  Use camera app
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
                Upload a video
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
