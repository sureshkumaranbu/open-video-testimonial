"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { ProgressBar } from "@/components/admin";
import { Icon } from "@/components/Icon";
import { ResumableUpload } from "@/lib/resumable-upload";

/** The fields of the row the video tools read. */
export type VideoToolsTestimonial = {
  id: string;
  projectId: string;
  videoKey: string | null;
  videoOriginalKey: string | null;
  videoMime: string | null;
  posterKey: string | null;
  videoDurationMs: number | null;
  mediaStatus: string;
  mediaError: string | null;
  trimStartMs: number | null;
  trimEndMs: number | null;
  posterAtMs: number | null;
  posterCustom: boolean;
};

type Panel = "trim" | "poster" | "replace" | null;
type TrimInfo = { durationMs: number; peaks: number[]; startMs: number; endMs: number };

/** 0:07.4 */
export function clock(ms: number) {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

const STEP_MS = 100;

/**
 * VID-01..04 in the drawer: trim with a waveform and a preview, pick or
 * upload the poster, replace the file, download the original or the MP4.
 * Every change is saved through the API, so it lands in the history.
 */
export function VideoTools({ t, onChanged }: { t: VideoToolsTestimonial; onChanged: () => void }) {
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const busy = t.mediaStatus === "queued" || t.mediaStatus === "processing";
  const ready = t.mediaStatus === "ready";
  const trimmed = t.trimStartMs !== null || t.trimEndMs !== null;

  const toggle = (p: Panel) => {
    setError(null);
    setStatus(null);
    setPanel((cur) => (cur === p ? null : p));
  };
  const done = (message: string) => {
    setPanel(null);
    setError(null);
    setStatus(message);
    onChanged();
  };

  return (
    <section className="stack ib-section ib-vtools" data-testid="video-tools" aria-labelledby={`vt-title-${t.id}`}>
      <h3 id={`vt-title-${t.id}`} className="ib-section-title">
        Video
      </h3>
      <p className="muted xsmall" data-testid="video-state" aria-live="polite">
        {busy
          ? "Converting the video… The current version stays up until the new one is ready."
          : t.mediaStatus === "failed"
            ? `Conversion failed: ${t.mediaError ?? "unknown error"}`
            : t.mediaStatus === "skipped"
              ? "Served as uploaded (ffmpeg isn't installed, so trimming and frame picking are off)."
              : trimmed
                ? `Trimmed: ${clock(t.trimStartMs ?? 0)} to ${t.trimEndMs !== null ? clock(t.trimEndMs) : "the end"} of the original.`
                : "The whole recording is shown."}
        {t.posterCustom ? " Poster: your image." : t.posterAtMs !== null ? ` Poster: frame at ${clock(t.posterAtMs)}.` : ""}
      </p>
      <div className="row ib-vtools-actions">
        <button type="button" className="secondary small" onClick={() => toggle("trim")} aria-expanded={panel === "trim"} disabled={!ready && !trimmed} data-testid="vt-trim">
          <Icon name="sliders" />
          Trim
        </button>
        <button type="button" className="secondary small" onClick={() => toggle("poster")} aria-expanded={panel === "poster"} data-testid="vt-poster">
          <Icon name="image" />
          Poster
        </button>
        <button type="button" className="secondary small" onClick={() => toggle("replace")} aria-expanded={panel === "replace"} data-testid="vt-replace">
          <Icon name="upload" />
          Replace video
        </button>
        <a className="button ghost small" href={`/api/admin/testimonials/${t.id}/download?file=original`} download data-testid="vt-download-original">
          <Icon name="download" />
          Original
        </a>
        {ready && (
          <a className="button ghost small" href={`/api/admin/testimonials/${t.id}/download?file=mp4`} download data-testid="vt-download-mp4">
            <Icon name="download" />
            MP4
          </a>
        )}
      </div>
      {status && (
        <p className="small notice" role="status" data-testid="vt-status">
          {status}
        </p>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {panel === "trim" && <TrimPanel t={t} onError={setError} onDone={() => done("Saved. The trimmed video is being made; it replaces the current one when it's ready.")} onCancel={() => setPanel(null)} />}
      {panel === "poster" && <PosterPanel t={t} onError={setError} onDone={() => done("Poster updated everywhere it's shown.")} />}
      {panel === "replace" && <ReplacePanel t={t} onError={setError} onDone={() => done("Video replaced. It's being converted, and the transcript is made again.")} />}
    </section>
  );
}

function Waveform({ peaks, start, end, duration }: { peaks: number[]; start: number; end: number; duration: number }) {
  const w = peaks.length;
  const a = (start / duration) * w;
  const b = (end / duration) * w;
  return (
    <svg className="ib-wave" viewBox={`0 0 ${w} 40`} preserveAspectRatio="none" aria-hidden="true" data-testid="vt-waveform">
      {peaks.map((p, i) => {
        const h = Math.max(1, p * 38);
        return <rect key={i} x={i} y={20 - h / 2} width={0.7} height={h} data-in={i >= a && i < b ? "1" : "0"} />;
      })}
      <rect className="ib-wave-cut" x={0} y={0} width={a} height={40} />
      <rect className="ib-wave-cut" x={b} y={0} width={Math.max(0, w - b)} height={40} />
    </svg>
  );
}

function TrimPanel({ t, onError, onDone, onCancel }: { t: VideoToolsTestimonial; onError: (e: string | null) => void; onDone: () => void; onCancel: () => void }) {
  const [info, setInfo] = useState<TrimInfo | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [saving, setSaving] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stopAt = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    api<TrimInfo>(`/api/admin/testimonials/${t.id}/trim`)
      .then((i) => {
        if (!live) return;
        setInfo(i);
        setStart(i.startMs);
        setEnd(i.endMs);
      })
      .catch((e) => live && onError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [t.id, onError]);

  const seek = (ms: number) => {
    const v = video.current;
    if (v) v.currentTime = ms / 1000;
  };

  const preview = () => {
    const v = video.current;
    if (!v) return;
    stopAt.current = end;
    v.currentTime = start / 1000;
    void v.play().catch(() => undefined);
  };

  const save = async (range: { startMs: number | null; endMs: number | null }) => {
    setSaving(true);
    onError(null);
    try {
      await api(`/api/admin/testimonials/${t.id}/trim`, { method: "PUT", json: range });
      onDone();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!info) return <p className="muted small">Reading the video…</p>;
  const original = t.videoOriginalKey ?? t.videoKey;
  // Untrimmed, the MP4 has the original's timeline and plays everywhere; trimmed, only the original does.
  const untrimmedMp4 = t.trimStartMs === null && t.trimEndMs === null && t.mediaStatus === "ready" && t.videoKey !== original;
  const kept = end - start;
  return (
    <div className="stack ib-vtool" data-testid="trim-panel">
      <video
        ref={video}
        controls
        preload="metadata"
        playsInline
        onTimeUpdate={(e) => {
          if (stopAt.current !== null && e.currentTarget.currentTime * 1000 >= stopAt.current) {
            e.currentTarget.pause();
            stopAt.current = null;
          }
        }}
      >
        {untrimmedMp4 && <source src={`/api/media/${t.videoKey}`} type="video/mp4" />}
        <source src={`/api/media/${original}`} />
      </video>
      <Waveform peaks={info.peaks} start={start} end={end} duration={info.durationMs} />
      <div className="ib-trim-ranges">
        <label className="ib-mini">
          Start <output data-testid="trim-start-value">{clock(start)}</output>
          <input
            type="range"
            min={0}
            max={info.durationMs}
            step={STEP_MS}
            value={start}
            aria-valuetext={clock(start)}
            data-testid="trim-start"
            onChange={(e) => {
              const v = Math.min(Number(e.target.value), end - 1000);
              setStart(Math.max(0, v));
              seek(Math.max(0, v));
            }}
          />
        </label>
        <label className="ib-mini">
          End <output data-testid="trim-end-value">{clock(end)}</output>
          <input
            type="range"
            min={0}
            max={info.durationMs}
            step={STEP_MS}
            value={end}
            aria-valuetext={clock(end)}
            data-testid="trim-end"
            onChange={(e) => {
              const v = Math.max(Number(e.target.value), start + 1000);
              setEnd(Math.min(info.durationMs, v));
              seek(Math.min(info.durationMs, v));
            }}
          />
        </label>
      </div>
      <p className="muted xsmall">
        Keeps {clock(kept)} of {clock(info.durationMs)}. The original file is kept, so you can change or undo this later. Captions follow the cut; when
        there are captions, the transcript becomes the words in the part you keep.
      </p>
      <div className="row ib-vtools-actions">
        <button type="button" className="secondary small" onClick={preview} data-testid="trim-preview">
          <Icon name="play" />
          Preview the cut
        </button>
        <button type="button" className="small" disabled={saving} onClick={() => void save({ startMs: start, endMs: end })} data-testid="trim-save">
          {saving ? "Saving…" : "Save trim"}
        </button>
        {(t.trimStartMs !== null || t.trimEndMs !== null) && (
          <button type="button" className="ghost small" disabled={saving} onClick={() => void save({ startMs: null, endMs: null })} data-testid="trim-clear">
            <Icon name="undo" />
            Show the whole video
          </button>
        )}
        <button type="button" className="ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function PosterPanel({ t, onError, onDone }: { t: VideoToolsTestimonial; onError: (e: string | null) => void; onDone: () => void }) {
  const [at, setAt] = useState(t.posterAtMs ?? 0);
  const [saving, setSaving] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const duration = t.videoDurationMs ?? 0;
  const canPick = t.mediaStatus === "ready" && duration > 0;

  const run = useCallback(
    async (init: Parameters<typeof api>[1]) => {
      setSaving(true);
      onError(null);
      try {
        await api(`/api/admin/testimonials/${t.id}/poster`, init);
        onDone();
      } catch (e) {
        onError(errorMessage(e));
      } finally {
        setSaving(false);
      }
    },
    [t.id, onError, onDone],
  );

  return (
    <div className="stack ib-vtool" data-testid="poster-panel">
      {canPick ? (
        <>
          <video ref={video} preload="auto" playsInline muted src={`/api/media/${t.videoKey}`} onLoadedMetadata={(e) => (e.currentTarget.currentTime = at / 1000)} />
          <label className="ib-mini">
            Frame <output data-testid="poster-at-value">{clock(at)}</output>
            <input
              type="range"
              min={0}
              max={duration}
              step={STEP_MS}
              value={at}
              aria-valuetext={clock(at)}
              data-testid="poster-at"
              onChange={(e) => {
                const v = Number(e.target.value);
                setAt(v);
                if (video.current) video.current.currentTime = v / 1000;
              }}
            />
          </label>
          <div className="row ib-vtools-actions">
            <button type="button" className="small" disabled={saving} onClick={() => void run({ method: "POST", json: { atMs: at } })} data-testid="poster-use-frame">
              {saving ? "Saving…" : "Use this frame"}
            </button>
          </div>
        </>
      ) : (
        <p className="muted small">Picking a frame needs the converted video. You can still upload an image.</p>
      )}
      <div className="row ib-vtools-actions">
        <label className="button secondary small ib-file">
          <Icon name="upload" />
          Upload an image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="visually-hidden"
            data-testid="poster-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const body = new FormData();
              body.set("file", file);
              void run({ method: "POST", body });
            }}
          />
        </label>
        {(t.posterCustom || t.posterAtMs !== null) && (
          <button type="button" className="ghost small" disabled={saving} onClick={() => void run({ method: "DELETE" })} data-testid="poster-reset">
            Use the default frame
          </button>
        )}
      </div>
      <p className="muted xsmall">PNG, JPEG, WebP or GIF. The poster shows on widgets, walls and the testimonial's own page.</p>
    </div>
  );
}

function ReplacePanel({ t, onError, onDone }: { t: VideoToolsTestimonial; onError: (e: string | null) => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const upload = useRef<ResumableUpload | null>(null);

  useEffect(() => () => void upload.current?.abort(), []);

  const send = async () => {
    if (!file) return;
    onError(null);
    setProgress(0);
    try {
      const up = new ResumableUpload({
        createUrl: `/api/admin/uploads?kind=video&projectId=${encodeURIComponent(t.projectId)}`,
        size: file.size,
        onProgress: (s) => setProgress(s.total ? Math.round((s.sent / s.total) * 100) : 0),
      });
      upload.current = up;
      up.append(file);
      const ref = await up.finish();
      await api(`/api/admin/testimonials/${t.id}/video`, { method: "POST", json: { upload: ref } });
      onDone();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      upload.current = null;
      setProgress(null);
    }
  };

  return (
    <div className="stack ib-vtool" data-testid="replace-panel">
      <p className="small">
        The new file takes the old one&rsquo;s place everywhere. Its trim and poster are cleared, it&rsquo;s converted again, and the transcript is made again
        (when transcription is set up). The old files are deleted.
      </p>
      <label className="ib-mini">
        Video file
        <input type="file" accept="video/*" data-testid="replace-file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={progress !== null} />
      </label>
      {progress !== null && <ProgressBar label="Uploading" value={progress} />}
      <div className="row ib-vtools-actions">
        <button type="button" className="small" disabled={!file || progress !== null} onClick={() => void send()} data-testid="replace-send">
          {progress !== null ? "Uploading…" : "Replace the video"}
        </button>
      </div>
    </div>
  );
}
