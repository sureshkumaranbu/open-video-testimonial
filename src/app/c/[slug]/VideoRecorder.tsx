"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";

const MAX_SECONDS = 120;
const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

type State = "idle" | "previewing" | "recording" | "recorded";

/** Records from the camera with MediaRecorder, or accepts an uploaded file. */
export function VideoRecorder({ onChange }: { onChange: (video: Blob | null) => void }) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const liveRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(
    () => () => {
      stopStream();
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  useEffect(() => () => {
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  }, [playbackUrl]);

  function setResult(blob: Blob | null) {
    setPlaybackUrl(blob ? URL.createObjectURL(blob) : null);
    onChange(blob);
  }

  async function openCamera() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Your browser can't record video here. You can upload a video file instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      streamRef.current = stream;
      setState("previewing");
      requestAnimationFrame(() => {
        if (liveRef.current) {
          liveRef.current.srcObject = stream;
          void liveRef.current.play().catch(() => undefined);
        }
      });
    } catch {
      setError("Your camera is blocked. Allow camera access in your browser, or upload a video file instead.");
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.onstop = () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopStream();
      const type = (recorder.mimeType || mimeType || "video/webm").split(";")[0];
      setResult(new Blob(chunks, { type }));
      setState("recorded");
    };
    recorderRef.current = recorder;
    recorder.start(1000);
    setSeconds(0);
    setState("recording");
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) recorder.state === "recording" && recorder.stop();
        return s + 1;
      });
    }, 1000);
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function reset() {
    setResult(null);
    setState("idle");
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    stopStream();
    setResult(file);
    setState("recorded");
  }

  const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const live = state === "previewing" || state === "recording";

  return (
    <div className="recorder" data-testid="video-recorder">
      {state === "recorded" && playbackUrl ? (
        <div className="recorder-playback">
          <video src={playbackUrl} controls playsInline aria-label="Your recording" />
        </div>
      ) : (
        <div className="recorder-stage">
          {live && <video ref={liveRef} muted playsInline aria-label="Camera preview" />}
          {state === "recording" && <span className="rec-pill live">REC {clock(seconds)}</span>}
          {state === "previewing" && <span className="rec-pill">Ready</span>}
          {state === "idle" && (
            <div className="recorder-empty">
              <button type="button" className="rec-button" onClick={openCamera}>
                Record with camera
              </button>
              <p>Up to {MAX_SECONDS / 60} minutes. Say your name, then what changed for you.</p>
            </div>
          )}
          {live && (
            <div className="recorder-controls">
              {state === "previewing" ? (
                <button type="button" className="rec-button" onClick={startRecording}>
                  Start recording
                </button>
              ) : (
                <button type="button" className="rec-button stop" onClick={stopRecording}>
                  Stop · {clock(MAX_SECONDS - seconds)} left
                </button>
              )}
            </div>
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
          {state !== "recording" && (
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
