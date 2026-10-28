"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { Icon } from "@/components/Icon";
import { VideoRecorder, type RecordedVideo } from "@/components/collect/VideoRecorder";
import type { FormVideoSlot } from "@/db/schema";
import type { AdminFormVideo, OwnerVideos } from "@/lib/video/form-videos";

export type OwnerVideoPanelProps = {
  formId: string;
  projectId: string;
  slot: FormVideoSlot;
  maxBytes: number;
  videos: AdminFormVideo[];
  onChange: (videos: AdminFormVideo[]) => void;
  /** The welcome page is off, so its video isn't shown yet. */
  pageOff?: boolean;
};

/** The playable ones, by page, for the builder's preview. */
export function ownerVideosFrom(videos: AdminFormVideo[]): OwnerVideos {
  const out: OwnerVideos = {};
  for (const v of videos) if (v.video) out[v.slot] = v.video;
  return out;
}

/** The longest owner video the recorder takes. Uploaded files are capped by size only. */
const MAX_SECONDS = 180;

const STATE: Record<string, string> = {
  none: "Waiting to convert…",
  queued: "Converting…",
  processing: "Converting…",
  skipped: "Shown as uploaded (ffmpeg isn't installed).",
  ready: "",
};

/**
 * FORM-17: the owner's own video for the welcome or thank-you page. Recorded
 * with the same recorder visitors use, or a file; it's converted and (when
 * transcription is set up) captioned, then plays on the page.
 */
export function OwnerVideoPanel({ formId, projectId, slot, maxBytes, videos, onChange, pageOff }: OwnerVideoPanelProps) {
  const current = videos.find((v) => v.slot === slot) ?? null;
  const [adding, setAdding] = useState(false);
  const [take, setTake] = useState<RecordedVideo | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { videos: next } = await api<{ videos: AdminFormVideo[] }>(`/api/admin/forms/${formId}/videos`);
    onChange(next);
  }, [formId, onChange]);

  const working = Boolean(current && (["none", "queued", "processing"].includes(current.mediaStatus) || ["queued", "processing"].includes(current.transcriptStatus)));
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => void refresh().catch(() => undefined), 2500);
    return () => clearInterval(timer);
  }, [working, refresh]);

  const use = async () => {
    if (!take) return;
    setSaving(true);
    setError(null);
    try {
      const upload = await take.upload.finish();
      const { videos: next } = await api<{ videos: AdminFormVideo[] }>(`/api/admin/forms/${formId}/videos`, { method: "POST", json: { slot, upload } });
      onChange(next);
      setAdding(false);
      setTake(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setError(null);
    try {
      const { videos: next } = await api<{ videos: AdminFormVideo[] }>(`/api/admin/forms/${formId}/videos?slot=${slot}`, { method: "DELETE" });
      onChange(next);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const where = slot === "welcome" ? "welcome page" : "thank-you page";
  return (
    <fieldset className="fb-fieldset stack" data-testid={`owner-video-${slot}`} data-status={current?.mediaStatus ?? "none"}>
      <legend>Your video (optional)</legend>
      <p className="muted xsmall">
        Say hello or thank people yourself. It plays on the {where} of this form, with captions once it&rsquo;s transcribed, and anyone can watch it while
        the form is live.
        {pageOff ? " Turn the welcome page on to show it." : ""}
      </p>
      {current && (
        <div className="stack" style={{ gap: "var(--space-2)" }}>
          {current.video && (
            <video controls playsInline preload="metadata" poster={current.video.poster ?? undefined} className="fb-owner-video">
              {current.video.sources.map((s) => (
                <source key={s.url} src={s.url} type={s.type} />
              ))}
              {current.video.captionsUrl && <track kind="captions" src={current.video.captionsUrl} default label="Captions" />}
            </video>
          )}
          <p className="muted xsmall" data-testid="owner-video-state" aria-live="polite">
            {current.mediaStatus === "failed" ? <span className="error">Conversion failed: {current.mediaError ?? "unknown error"}</span> : STATE[current.mediaStatus]}
            {current.mediaStatus === "ready" &&
              (current.hasCaptions
                ? "Captions are on."
                : current.transcriptStatus === "queued" || current.transcriptStatus === "processing"
                  ? "Making captions…"
                  : current.transcriptStatus === "failed"
                    ? "Captions couldn't be made."
                    : "No captions (transcription isn't set up).")}
          </p>
          <div className="row" style={{ gap: "var(--space-2)" }}>
            <button type="button" className="secondary small" onClick={() => setAdding(true)} disabled={adding}>
              <Icon name="video" />
              Replace
            </button>
            <button type="button" className="ghost small" onClick={() => void remove()} data-testid="owner-video-remove">
              <Icon name="trash" />
              Remove
            </button>
          </div>
        </div>
      )}
      {!current && !adding && (
        <button type="button" className="secondary small" onClick={() => setAdding(true)} data-testid="owner-video-add">
          <Icon name="video" />
          Record or upload a video
        </button>
      )}
      {adding && (
        <div className="stack" style={{ gap: "var(--space-2)" }}>
          <VideoRecorder
            slug=""
            questions={[]}
            maxSeconds={MAX_SECONDS}
            maxBytes={maxBytes}
            createUrl={`/api/admin/uploads?kind=video&projectId=${encodeURIComponent(projectId)}`}
            onChange={setTake}
          />
          <div className="row" style={{ gap: "var(--space-2)" }}>
            <button type="button" className="small" disabled={!take || saving} onClick={() => void use()} data-testid="owner-video-save">
              {saving ? "Saving…" : `Use on the ${where}`}
            </button>
            <button
              type="button"
              className="ghost small"
              onClick={() => {
                setAdding(false);
                setTake(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
