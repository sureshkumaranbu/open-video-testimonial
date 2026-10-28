"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { Icon } from "@/components/Icon";
import { LOOK_NAMES, MAX_SOCIAL_MS, SOCIAL_LOOKS, type SocialLook } from "@/lib/video/looks";
import { clock } from "./VideoTools";

/** A render as the API sends it (src/lib/video/renders.ts renderToAdmin). */
export type RenderJson = {
  id: string;
  kind: "multiclip" | "social" | "reel";
  status: "queued" | "processing" | "ready" | "failed";
  error: string | null;
  options: Record<string, unknown>;
  url: string | null;
  downloadUrl: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  usedAsVideo: boolean;
  createdAt: string;
};

type Info = { renders: RenderJson[]; multiclip: { clips: number; inUse: string | null }; captions: boolean; durationMs: number | null };

export const busyRender = (r: RenderJson) => r.status === "queued" || r.status === "processing";

/** "Making it… / Failed: why / 0:24, 1080×1920" for a render. */
export function RenderState({ r }: { r: RenderJson }) {
  if (r.status === "failed") {
    return (
      <span className="error xsmall" role="alert" data-testid="render-error">
        Failed: {r.error ?? "unknown error"}
      </span>
    );
  }
  if (busyRender(r)) return <span className="muted xsmall">{r.status === "queued" ? "Waiting to start…" : "Making it…"}</span>;
  return (
    <span className="muted xsmall">
      {r.durationMs !== null ? clock(r.durationMs) : ""}
      {r.width && r.height ? ` · ${r.width}×${r.height}` : ""}
    </span>
  );
}

/**
 * M16 in the drawer: a multiclip of the submission's video answers (VID-05),
 * and social clips with burned-in captions in our looks (VID-07). Both are
 * made in the background; this polls until they're done.
 */
export function VideoStudio({ testimonialId, onChanged }: { testimonialId: string; onChanged: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [look, setLook] = useState<SocialLook>("studio");
  const [format, setFormat] = useState<"vertical" | "square">("vertical");
  const [captions, setCaptions] = useState(true);
  const [nameTag, setNameTag] = useState(true);
  const [logo, setLogo] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await api<Info>(`/api/admin/testimonials/${testimonialId}/renders`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [testimonialId]);

  useEffect(() => {
    void load();
  }, [load]);

  const busy = Boolean(info?.renders.some(busyRender));
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [busy, load]);

  const run = async (fn: () => Promise<unknown>, changed = false) => {
    setSending(true);
    setError(null);
    try {
      await fn();
      await load();
      if (changed) onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  if (!info) return null;
  const multiclips = info.renders.filter((r) => r.kind === "multiclip");
  const long = info.durationMs !== null && info.durationMs > MAX_SOCIAL_MS;
  const socials = info.renders.filter((r) => r.kind === "social");
  const remove = (r: RenderJson) => run(() => api(`/api/admin/renders/${r.id}`, { method: "DELETE" }));

  return (
    <section className="stack ib-section ib-vstudio" data-testid="video-studio" aria-labelledby={`vs-title-${testimonialId}`}>
      <h3 id={`vs-title-${testimonialId}`} className="ib-section-title">
        Clips and multiclip
      </h3>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}

      {info.multiclip.clips >= 2 && (
        <div className="stack ib-vtool" data-testid="multiclip">
          <div className="row spread">
            <strong className="small">Multiclip</strong>
            <button
              type="button"
              className="secondary small"
              disabled={sending || multiclips.some(busyRender)}
              onClick={() => void run(() => api(`/api/admin/testimonials/${testimonialId}/multiclip`, { method: "POST" }))}
              data-testid="multiclip-make"
            >
              <Icon name="video" />
              {multiclips.length ? "Make it again" : "Make a multiclip"}
            </button>
          </div>
          <p className="muted xsmall">
            Joins all {info.multiclip.clips} video answers into one video, each after a card with its question in your brand colour.
          </p>
          {multiclips.map((r) => (
            <div key={r.id} className="stack ib-render" data-testid="multiclip-render" data-status={r.status}>
              <RenderState r={r} />
              {r.url && <video controls preload="metadata" playsInline src={r.url} />}
              {r.status === "ready" && (
                <div className="row ib-vtools-actions">
                  <a className="button ghost small" href={r.downloadUrl!} download data-testid="multiclip-download">
                    <Icon name="download" />
                    Download
                  </a>
                  {info.multiclip.inUse === r.id ? (
                    <button type="button" className="ghost small" disabled={sending} onClick={() => void run(() => api(`/api/admin/testimonials/${testimonialId}/multiclip`, { method: "PUT", json: { renderId: null } }), true)} data-testid="multiclip-unuse">
                      <Icon name="undo" />
                      Show the first answer again
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ghost small"
                      disabled={sending}
                      onClick={() =>
                        confirm("Show this multiclip as the testimonial's video? Its other answers become part of the public video, and the video is converted again.") &&
                        void run(() => api(`/api/admin/testimonials/${testimonialId}/multiclip`, { method: "PUT", json: { renderId: r.id } }), true)
                      }
                      data-testid="multiclip-use"
                    >
                      Use as the video
                    </button>
                  )}
                  {info.multiclip.inUse !== r.id && (
                    <button type="button" className="ghost small" disabled={sending} onClick={() => void remove(r)}>
                      <Icon name="trash" />
                      Delete
                    </button>
                  )}
                </div>
              )}
              {r.status === "failed" && (
                <button type="button" className="ghost small" onClick={() => void remove(r)}>
                  Dismiss
                </button>
              )}
              {info.multiclip.inUse === r.id && <span className="badge">Shown as the video</span>}
            </div>
          ))}
        </div>
      )}

      <div className="stack ib-vtool" data-testid="social-clip">
        <strong className="small">Social clip</strong>
        <div className="ib-social-grid">
          <label className="ib-mini">
            Shape
            <select value={format} onChange={(e) => setFormat(e.target.value as "vertical" | "square")} data-testid="social-format">
              <option value="vertical">Vertical 9:16 (Reels, TikTok, Shorts)</option>
              <option value="square">Square 1:1 (feeds)</option>
            </select>
          </label>
          <fieldset className="ib-looks">
            <legend className="small">Look</legend>
            {SOCIAL_LOOKS.map((l) => (
              <label key={l} className="check" title={LOOK_NAMES[l].hint}>
                <input type="radio" name={`look-${testimonialId}`} value={l} checked={look === l} onChange={() => setLook(l)} data-testid={`social-look-${l}`} />
                {LOOK_NAMES[l].label}
              </label>
            ))}
          </fieldset>
        </div>
        <p className="muted xsmall">{LOOK_NAMES[look].hint}</p>
        <div className="row ib-vtools-actions">
          <label className="check">
            <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} disabled={!info.captions} />
            Captions{info.captions ? "" : " (transcribe the video first)"}
          </label>
          <label className="check">
            <input type="checkbox" checked={nameTag} onChange={(e) => setNameTag(e.target.checked)} />
            Name tag
          </label>
          <label className="check">
            <input type="checkbox" checked={logo} onChange={(e) => setLogo(e.target.checked)} />
            Logo
          </label>
        </div>
        <div className="row ib-vtools-actions">
          <button
            type="button"
            className="small"
            disabled={sending || socials.some(busyRender)}
            onClick={() =>
              void run(() =>
                api(`/api/admin/testimonials/${testimonialId}/social-clip`, {
                  method: "POST",
                  // A longer video gives its first three minutes.
                  json: { look, format, captions: captions && info.captions, nameTag, logo, ...(long ? { startMs: 0, endMs: MAX_SOCIAL_MS } : {}) },
                }),
              )
            }
            data-testid="social-make"
          >
            <Icon name="video" />
            Make the clip
          </button>
          {long && <span className="muted xsmall">The first 3 minutes are used. Trim the video to choose another part.</span>}
        </div>
        {socials.map((r) => (
          <div key={r.id} className="stack ib-render" data-testid="social-render" data-status={r.status}>
            <span className="small">
              {LOOK_NAMES[(r.options.look as SocialLook) ?? "studio"]?.label ?? "Clip"}, {r.options.format === "square" ? "square" : "vertical"} <RenderState r={r} />
            </span>
            {r.url && <video className={r.options.format === "square" ? "ib-render-square" : "ib-render-tall"} controls preload="metadata" playsInline src={r.url} />}
            <div className="row ib-vtools-actions">
              {r.status === "ready" && (
                <a className="button ghost small" href={r.downloadUrl!} download data-testid="social-download">
                  <Icon name="download" />
                  Download MP4
                </a>
              )}
              {!busyRender(r) && (
                <button type="button" className="ghost small" disabled={sending} onClick={() => void remove(r)}>
                  <Icon name="trash" />
                  {r.status === "failed" ? "Dismiss" : "Delete"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
