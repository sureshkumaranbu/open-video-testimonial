"use client";

import { useEffect, useRef, useState } from "react";

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
      setError("We couldn't access your camera. Check permissions, or upload a video file instead.");
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

  return (
    <div className="stack" data-testid="video-recorder">
      {state === "previewing" || state === "recording" ? (
        <video ref={liveRef} className="recorder-preview" muted playsInline aria-label="Camera preview" />
      ) : null}
      {state === "recorded" && playbackUrl ? (
        <video src={playbackUrl} controls playsInline aria-label="Your recording" />
      ) : null}

      <div className="row">
        {state === "idle" && (
          <button type="button" onClick={openCamera}>
            🎥 Record with camera
          </button>
        )}
        {state === "previewing" && (
          <button type="button" onClick={startRecording}>
            ● Start recording
          </button>
        )}
        {state === "recording" && (
          <button type="button" onClick={stopRecording}>
            ■ Stop ({MAX_SECONDS - seconds}s left)
          </button>
        )}
        {state === "recorded" && (
          <button type="button" className="secondary" onClick={reset}>
            Record again
          </button>
        )}
        {state !== "recording" && (
          <label className="button secondary" style={{ flexDirection: "row", fontWeight: 600 }}>
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
      <p className="muted small" style={{ margin: 0 }}>
        Up to {MAX_SECONDS / 60} minutes. Tip: say your name and what changed for you.
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
