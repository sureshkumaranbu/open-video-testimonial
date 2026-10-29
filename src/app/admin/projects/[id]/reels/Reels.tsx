"use client";

import "@/app/admin/reels.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { EmptyState, Toggle, UnsavedGuard } from "@/components/admin";
import { Icon } from "@/components/Icon";
import { FORMAT_NAMES, RENDER_FORMATS, type RenderFormat } from "@/lib/video/looks";
import { MAX_REEL_CLIPS, MAX_REEL_MS, reelLengthMs, type ReelClip, type ReelConfig } from "@/lib/video/reel-config";
import { rangeOfWords, type Word } from "@/lib/video/words";
import { busyRender, RenderState, type RenderJson } from "../inbox/VideoStudio";
import { clock } from "../inbox/VideoTools";

type Reel = { id: string; name: string; config: ReelConfig; lengthMs: number; warnings: string[]; renders: RenderJson[]; updatedAt: string };
type Candidate = { id: string; name: string; detail: string | null; durationMs: number | null; videoUrl: string | null; posterUrl: string | null; transcript: string | null; words: Word[] | null };

const EMPTY: ReelConfig = { format: "landscape", title: "", subtitle: "", closingTitle: "", closingSubtitle: "", music: true, captions: true, clips: [] };
const seconds = (ms: number) => Math.round(ms / 100) / 10;

/**
 * VID-08: highlight reels. The list on the left; the chosen reel's cards,
 * music and clips on the right. A clip is added by picking an approved video
 * and selecting the words to keep in its transcript (or typing the times when
 * it has no captions). Rendering saves first, then makes the MP4 in the background.
 */
export function Reels({ projectId, initial, candidates }: { projectId: string; initial: Reel[]; candidates: Candidate[] }) {
  const [reels, setReels] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(initial[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const open = reels.find((r) => r.id === openId) ?? null;

  const replace = (reel: Reel) => setReels((rs) => (rs.some((r) => r.id === reel.id) ? rs.map((r) => (r.id === reel.id ? reel : r)) : [reel, ...rs]));

  const create = async () => {
    setError(null);
    try {
      const { reel } = await api<{ reel: Reel }>(`/api/admin/projects/${projectId}/reels`, { method: "POST", json: { name: newName.trim() || "Highlight reel", config: EMPTY } });
      replace(reel);
      setOpenId(reel.id);
      setNewName("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="rl-layout">
      <aside className="panel panel-body stack rl-list" aria-label="Reels">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label className="rl-field">
            New reel
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Spring launch" maxLength={120} data-testid="reel-new-name" />
          </label>
          <button type="submit" className="secondary small" data-testid="reel-create">
            <Icon name="plus" />
            Make a reel
          </button>
        </form>
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
        <ul className="rl-items">
          {reels.map((r) => (
            <li key={r.id}>
              <button type="button" className={`ghost small${r.id === openId ? " rl-current" : ""}`} aria-current={r.id === openId ? "true" : undefined} onClick={() => setOpenId(r.id)}>
                {r.name}
                <span className="muted xsmall"> · {r.config.clips.length} clips</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="rl-main">
        {open ? (
          <ReelEditor
            key={open.id}
            reel={open}
            candidates={candidates}
            onSaved={replace}
            onDeleted={() => {
              setReels((rs) => rs.filter((r) => r.id !== open.id));
              setOpenId(null);
            }}
          />
        ) : (
          <EmptyState title={reels.length ? "Choose a reel" : "No reels yet"} testId="reels-empty">
            {candidates.length ? "Make a reel, then add clips from your approved video testimonials." : "Approve a video testimonial first; reels use approved videos only."}
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function ReelEditor({ reel, candidates, onSaved, onDeleted }: { reel: Reel; candidates: Candidate[]; onSaved: (r: Reel) => void; onDeleted: () => void }) {
  const [name, setName] = useState(reel.name);
  const [config, setConfig] = useState<ReelConfig>(reel.config);
  const [saved, setSaved] = useState(() => JSON.stringify({ name: reel.name, config: reel.config }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const dirty = JSON.stringify({ name, config }) !== saved;
  const set = (patch: Partial<ReelConfig>) => setConfig((c) => ({ ...c, ...patch }));
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const length = reelLengthMs(config);

  const refresh = useCallback(async () => {
    const { reel: fresh } = await api<{ reel: Reel }>(`/api/admin/reels/${reel.id}`);
    onSaved(fresh);
    return fresh;
  }, [reel.id, onSaved]);

  const rendering = reel.renders.some(busyRender);
  useEffect(() => {
    if (!rendering) return;
    const timer = setInterval(() => void refresh().catch(() => undefined), 2000);
    return () => clearInterval(timer);
  }, [rendering, refresh]);

  const save = async () => {
    const { reel: next } = await api<{ reel: Reel }>(`/api/admin/reels/${reel.id}`, { method: "PUT", json: { name, config } });
    setSaved(JSON.stringify({ name: next.name, config: next.config }));
    onSaved(next);
    return next;
  };

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const move = (i: number, by: number) => {
    const clips = [...config.clips];
    const [c] = clips.splice(i, 1);
    clips.splice(Math.max(0, Math.min(clips.length, i + by)), 0, c);
    set({ clips });
  };
  const setClip = (i: number, patch: Partial<ReelClip>) => set({ clips: config.clips.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return (
    <div className="stack-lg" data-testid="reel-editor">
      <UnsavedGuard dirty={dirty} />
      <div className="panel panel-body stack">
        <div className="row spread">
          <label className="rl-field rl-name">
            Name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-testid="reel-name" />
          </label>
          <div className="row" style={{ gap: "var(--space-2)" }}>
            <button type="button" className="secondary small" disabled={!dirty || busy} onClick={() =>
                void act(async () => {
                  await save();
                  setStatus("Saved");
                })
              } data-testid="reel-save">
              {dirty ? "Save" : "Saved"}
            </button>
            <button
              type="button"
              className="small"
              disabled={busy || rendering || !config.clips.length}
              onClick={() =>
                void act(async () => {
                  if (dirty) await save();
                  await api(`/api/admin/reels/${reel.id}/render`, { method: "POST" });
                  await refresh();
                  setStatus("Rendering. It appears below when it's ready.");
                })
              }
              data-testid="reel-render"
            >
              <Icon name="video" />
              {rendering ? "Rendering…" : "Render the reel"}
            </button>
          </div>
        </div>
        <div className="rl-grid">
          <label className="rl-field">
            Shape
            <select value={config.format} onChange={(e) => set({ format: e.target.value as RenderFormat })} data-testid="reel-format">
              {RENDER_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_NAMES[f]}
                </option>
              ))}
            </select>
          </label>
          <Toggle label="Background music" hint="An original ambient bed Plaudit makes itself, under the voices." checked={config.music} onChange={(music) => set({ music })} testId="reel-music" />
          <Toggle label="Captions" hint="Word by word, for clips that have captions." checked={config.captions} onChange={(captions) => set({ captions })} />
        </div>
        <div className="rl-grid">
          <label className="rl-field">
            Title card
            <input type="text" value={config.title} maxLength={120} placeholder="What our customers say" onChange={(e) => set({ title: e.target.value })} data-testid="reel-title" />
          </label>
          <label className="rl-field">
            Under the title
            <input type="text" value={config.subtitle} maxLength={160} onChange={(e) => set({ subtitle: e.target.value })} />
          </label>
          <label className="rl-field">
            Closing card
            <input type="text" value={config.closingTitle} maxLength={120} placeholder="Try it free today" onChange={(e) => set({ closingTitle: e.target.value })} data-testid="reel-closing" />
          </label>
          <label className="rl-field">
            Under the closing title
            <input type="text" value={config.closingSubtitle} maxLength={160} placeholder="acme.com" onChange={(e) => set({ closingSubtitle: e.target.value })} />
          </label>
        </div>
        <p className={`xsmall ${length > MAX_REEL_MS ? "error" : "muted"}`} data-testid="reel-length">
          {clock(length)} in all{length > MAX_REEL_MS ? ` — a reel can be up to ${MAX_REEL_MS / 60000} minutes` : ""}.
        </p>
        {reel.warnings.map((w) => (
          <p key={w} className="notice small" data-testid="reel-warning">
            {w}
          </p>
        ))}
        {status && (
          <p className="small notice" role="status">
            {status}
          </p>
        )}
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="panel panel-body stack">
        <h2 className="section-title">Clips</h2>
        {config.clips.length === 0 && <p className="muted small">No clips yet. Add one below.</p>}
        <ol className="rl-clips" data-testid="reel-clips">
          {config.clips.map((c, i) => {
            const t = byId.get(c.testimonialId);
            return (
              <li key={`${c.testimonialId}-${i}`} className="rl-clip" data-testid="reel-clip">
                <strong className="small">{t?.name ?? "A testimonial that's no longer approved"}</strong>
                <TimeInput label="From" ms={c.startMs} onChange={(startMs) => setClip(i, { startMs })} />
                <TimeInput label="To" ms={c.endMs} onChange={(endMs) => setClip(i, { endMs })} />
                <span className="muted xsmall">{clock(c.endMs - c.startMs)}</span>
                <span className="row" style={{ gap: 4 }}>
                  <button type="button" className="ghost small" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                    ↑
                  </button>
                  <button type="button" className="ghost small" onClick={() => move(i, 1)} disabled={i === config.clips.length - 1} aria-label="Move down">
                    ↓
                  </button>
                  <button type="button" className="ghost small" onClick={() => set({ clips: config.clips.filter((_, j) => j !== i) })} aria-label="Remove the clip">
                    <Icon name="trash" />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
        {config.clips.length < MAX_REEL_CLIPS && <ClipPicker candidates={candidates} onAdd={(clip) => set({ clips: [...config.clips, clip] })} />}
      </div>

      {reel.renders.length > 0 && (
        <div className="panel panel-body stack" data-testid="reel-renders">
          <h2 className="section-title">Renders</h2>
          {reel.renders.map((r) => (
            <div key={r.id} className="stack ib-render" data-testid="reel-render-row" data-status={r.status}>
              <span className="small">
                {new Date(r.createdAt).toLocaleString()} <RenderState r={r} />
              </span>
              {r.url && <video className="rl-video" controls preload="metadata" playsInline src={r.url} />}
              <div className="row ib-vtools-actions">
                {r.downloadUrl && (
                  <a className="button ghost small" href={r.downloadUrl} download data-testid="reel-download">
                    <Icon name="download" />
                    Download MP4
                  </a>
                )}
                {!busyRender(r) && (
                  <button type="button" className="ghost small" onClick={() =>
                      void act(async () => {
                        await api(`/api/admin/renders/${r.id}`, { method: "DELETE" });
                        await refresh();
                      })
                    }>
                    <Icon name="trash" />
                    {r.status === "failed" ? "Dismiss" : "Delete"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <button
          type="button"
          className="danger small"
          disabled={busy}
          onClick={() =>
            confirm(`Delete “${reel.name}” and its renders?`) &&
            void act(async () => {
              await api(`/api/admin/reels/${reel.id}`, { method: "DELETE" });
              onDeleted();
            })
          }
        >
          <Icon name="trash" />
          Delete reel
        </button>
      </div>
    </div>
  );
}

function TimeInput({ label, ms, onChange }: { label: string; ms: number; onChange: (ms: number) => void }) {
  return (
    <label className="rl-time">
      {label}
      <input
        type="number"
        min={0}
        step={0.1}
        value={seconds(ms)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= 0) onChange(Math.round(v * 1000));
        }}
      />
      <span className="muted xsmall">s</span>
    </label>
  );
}

/**
 * Picks a testimonial and the part of it to use: select words in its
 * transcript (then "Use the selected words"), or type the times.
 */
function ClipPicker({ candidates, onAdd }: { candidates: Candidate[]; onAdd: (c: ReelClip) => void }) {
  const [id, setId] = useState(candidates[0]?.id ?? "");
  const t = candidates.find((c) => c.id === id) ?? null;
  const [range, setRange] = useState<{ startMs: number; endMs: number }>({ startMs: 0, endMs: 0 });
  const [hint, setHint] = useState<string | null>(null);
  const words = useRef<HTMLParagraphElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setRange({ startMs: 0, endMs: Math.min(t?.durationMs ?? 0, 15_000) });
    setHint(null);
  }, [t]);

  if (!candidates.length) return <p className="muted small">Reels use approved, converted video testimonials. Approve one to add clips.</p>;

  const takeSelection = () => {
    const sel = window.getSelection();
    const box = words.current;
    if (!sel || sel.isCollapsed || !box || !t?.words) {
      setHint("Select some words in the transcript first.");
      return;
    }
    const indexOf = (node: Node | null) => {
      const el = node instanceof Element ? node : node?.parentElement;
      const span = el?.closest<HTMLElement>("[data-w]");
      return span && box.contains(span) ? Number(span.dataset.w) : null;
    };
    const a = indexOf(sel.anchorNode);
    const b = indexOf(sel.focusNode);
    const r = a !== null && b !== null ? rangeOfWords(t.words, a, b) : null;
    if (!r) {
      setHint("Select words inside the transcript.");
      return;
    }
    setRange(r);
    setHint(null);
    if (video.current) video.current.currentTime = r.startMs / 1000;
  };

  const ok = range.endMs - range.startMs >= 1000 && range.endMs - range.startMs <= 120_000;
  return (
    <div className="stack ib-vtool" data-testid="clip-picker">
      <label className="rl-field">
        Testimonial
        <select value={id} onChange={(e) => setId(e.target.value)} data-testid="clip-testimonial">
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.detail ? `, ${c.detail}` : ""}
            </option>
          ))}
        </select>
      </label>
      {t?.videoUrl && <video ref={video} className="rl-video" controls preload="metadata" playsInline poster={t.posterUrl ?? undefined} src={t.videoUrl} key={t.id} />}
      {t?.words ? (
        <>
          <p className="muted xsmall">Select the words to keep, then use them. You can fine-tune the times afterwards.</p>
          <p ref={words} className="rl-words" data-testid="clip-words">
            {t.words.map((w, i) => (
              <span key={i} data-w={i} data-start={w.start} className={w.start * 1000 >= range.startMs && w.end * 1000 <= range.endMs + 1 ? "rl-word-in" : undefined}>
                {w.text}{" "}
              </span>
            ))}
          </p>
          <div>
            <button type="button" className="secondary small" onMouseDown={(e) => e.preventDefault()} onClick={takeSelection} data-testid="clip-use-selection">
              Use the selected words
            </button>
          </div>
        </>
      ) : (
        <p className="muted xsmall">{t?.transcript ? "This video has a transcript but no captions with times, so choose the part by its times." : "No transcript yet, so choose the part by its times."}</p>
      )}
      {hint && (
        <p className="error xsmall" role="alert">
          {hint}
        </p>
      )}
      <div className="row ib-vtools-actions">
        <TimeInput label="From" ms={range.startMs} onChange={(startMs) => setRange((r) => ({ ...r, startMs }))} />
        <TimeInput label="To" ms={range.endMs} onChange={(endMs) => setRange((r) => ({ ...r, endMs }))} />
        <span className="muted xsmall" data-testid="clip-range">
          {clock(range.startMs)} – {clock(range.endMs)}
        </span>
        <button type="button" className="small" disabled={!t || !ok} onClick={() => t && onAdd({ testimonialId: t.id, ...range })} data-testid="clip-add">
          <Icon name="plus" />
          Add to the reel
        </button>
      </div>
      {!ok && <p className="muted xsmall">A clip runs from 1 second to 2 minutes.</p>}
    </div>
  );
}
