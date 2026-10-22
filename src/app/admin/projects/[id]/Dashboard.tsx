"use client";

import { useCallback, useEffect, useState } from "react";
import type { MediaStatus, Project, TestimonialStatus, TranscriptStatus } from "@/db/schema";
import type { SystemStatus } from "@/lib/system";
import { Icon } from "@/components/Icon";
import { Avatar, Stars } from "@/components/TestimonialCard";
import { accentStyle } from "@/lib/theme";

type AdminTestimonial = {
  id: string;
  status: TestimonialStatus;
  rating: number | null;
  text: string | null;
  authorName: string;
  authorEmail: string | null;
  authorTitle: string | null;
  authorCompany: string | null;
  avatarKey: string | null;
  videoKey: string | null;
  videoMime: string | null;
  posterKey: string | null;
  videoOriginalKey: string | null;
  mediaStatus: MediaStatus;
  mediaError: string | null;
  transcript: string | null;
  captionsVtt: string | null;
  transcriptStatus: TranscriptStatus;
  transcriptError: string | null;
  createdAt: string;
  tags: string[];
};

type Filter = TestimonialStatus | "all";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "all", label: "All" },
];

const EMPTY: Record<Filter, string> = {
  pending: "Nothing to review. New testimonials show up here first.",
  approved: "Nothing approved yet. Approved testimonials appear on your wall and widgets.",
  rejected: "Nothing rejected.",
  all: "No testimonials yet. Share your collection link to get the first one.",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function Dashboard({
  project: initial,
  publicUrl,
  system,
}: {
  project: Project;
  publicUrl: string;
  system: SystemStatus;
}) {
  const [project, setProject] = useState(initial);
  const [filter, setFilter] = useState<Filter>("pending");
  const [all, setAll] = useState<AdminTestimonial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ testimonials: AdminTestimonial[] }>(`/api/admin/projects/${project.id}`);
      setAll(data.testimonials);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh while videos are being converted so the result shows up by itself.
  const busy = (s: string) => s === "queued" || s === "processing";
  const processing = all.some((t) => busy(t.mediaStatus) || busy(t.transcriptStatus));
  useEffect(() => {
    if (!processing) return;
    const id = setInterval(() => void load(), 3000);
    return () => clearInterval(id);
  }, [processing, load]);

  const counts = {
    pending: all.filter((t) => t.status === "pending").length,
    approved: all.filter((t) => t.status === "approved").length,
    rejected: all.filter((t) => t.status === "rejected").length,
    all: all.length,
  };
  const items = filter === "all" ? all : all.filter((t) => t.status === filter);

  async function update(id: string, patch: Record<string, unknown>) {
    try {
      await api(`/api/admin/testimonials/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function transcribe(id: string) {
    try {
      await api(`/api/admin/testimonials/${id}/transcribe`, { method: "POST" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function reprocess(id: string) {
    try {
      await api(`/api/admin/testimonials/${id}/reprocess`, { method: "POST" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this testimonial and its video permanently? This can't be undone.")) return;
    try {
      await api(`/api/admin/testimonials/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="stack-lg" style={accentStyle(project.accentColor)}>
      <div className="page-head">
        <div className="row" style={{ flexWrap: "nowrap", gap: "var(--space-4)" }}>
          <span className="org-mark" aria-hidden style={{ width: 52, height: 52, fontSize: "var(--text-xl)" }}>
            {project.name.trim().charAt(0).toUpperCase()}
          </span>
          <div>
            <h1>{project.name}</h1>
            <p className="muted small" style={{ marginTop: 2 }}>
              Collecting at /c/{project.slug}
            </p>
          </div>
        </div>
        <div className="row">
          <a className="button secondary small" href={`/c/${project.slug}`} target="_blank" rel="noreferrer">
            Collection page
            <Icon name="external" />
          </a>
          <a className="button secondary small" href={`/wall/${project.slug}`} target="_blank" rel="noreferrer">
            Wall of love
            <Icon name="external" />
          </a>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat pending">
          <strong>{counts.pending}</strong>
          <span>Waiting for review</span>
        </div>
        <div className="stat">
          <strong>{counts.approved}</strong>
          <span>Live on your site</span>
        </div>
        <div className="stat">
          <strong>{all.filter((t) => t.videoKey).length}</strong>
          <span>Video testimonials</span>
        </div>
      </div>

      <div className="workspace">
        <section className="queue" aria-label="Testimonials">
          <div className="row spread">
            <div className="segmented" role="group" aria-label="Filter by status">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                  <span className="count">{counts[f.id]}</span>
                </button>
              ))}
            </div>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {loading ? <p className="muted">Loading testimonials…</p> : null}
          {!loading && items.length === 0 ? (
            <div className="empty">
              <Icon name="inbox" />
              <p>{EMPTY[filter]}</p>
            </div>
          ) : null}
          {items.map((t) => (
            <TestimonialRow
              key={t.id}
              t={t}
              onUpdate={(patch) => update(t.id, patch)}
              onDelete={() => remove(t.id)}
              onReprocess={() => reprocess(t.id)}
              onTranscribe={() => transcribe(t.id)}
              transcription={system.transcription.enabled && system.ffmpeg}
            />
          ))}
        </section>

        <aside>
          <EmbedPanel slug={project.slug} publicUrl={publicUrl} />
          <SettingsPanel project={project} onSaved={setProject} />
        </aside>
      </div>
    </div>
  );
}

const MEDIA_NOTE: Partial<Record<MediaStatus, string>> = {
  queued: "Converting video…",
  processing: "Converting video…",
  skipped: "ffmpeg isn't installed, so the original file is served as uploaded. Some browsers may not play it.",
};

function TestimonialRow({
  t,
  onUpdate,
  onDelete,
  onReprocess,
  onTranscribe,
  transcription,
}: {
  t: AdminTestimonial;
  onUpdate: (patch: Record<string, unknown>) => Promise<void> | void;
  onDelete: () => void;
  onReprocess: () => void;
  onTranscribe: () => void;
  transcription: boolean;
}) {
  const [name, setName] = useState(t.authorName);
  const [tags, setTags] = useState(t.tags.join(", "));
  const savedTags = t.tags.join(", ");
  // Show what the server saved (tags are normalised to lowercase) after a save.
  useEffect(() => {
    setName(t.authorName);
    setTags(savedTags);
  }, [t.authorName, savedTags]);
  const avatarUrl = t.avatarKey ? `/api/media/${t.avatarKey}` : null;
  const dirty = name.trim() !== t.authorName || tags !== t.tags.join(", ");
  const byline = [t.authorTitle, t.authorCompany].filter(Boolean).join(", ");

  return (
    <article className="panel review" data-testid="admin-testimonial" data-status={t.status}>
      <div className="row spread" style={{ alignItems: "flex-start" }}>
        <div className="who">
          <Avatar name={t.authorName} url={avatarUrl} />
          <div style={{ minWidth: 0 }}>
            <strong>{t.authorName}</strong>
            <div className="meta">
              {[byline, t.authorEmail].filter(Boolean).join(" · ") || "No details given"}
            </div>
          </div>
        </div>
        <div className="row small" style={{ gap: "var(--space-2)" }}>
          <span className={`badge ${t.status}`}>{t.status[0].toUpperCase() + t.status.slice(1)}</span>
          <span className="muted xsmall">{timeAgo(t.createdAt)}</span>
        </div>
      </div>

      {t.videoKey && (
        <video
          controls
          preload={t.posterKey ? "none" : "metadata"}
          playsInline
          poster={t.posterKey ? `/api/media/${t.posterKey}` : undefined}
          key={t.videoKey}
        >
          <source src={`/api/media/${t.videoKey}`} type={t.mediaStatus === "ready" ? 'video/mp4; codecs="avc1.640028, mp4a.40.2"' : (t.videoMime ?? undefined)} />
          {t.videoOriginalKey && t.videoOriginalKey !== t.videoKey && <source src={`/api/media/${t.videoOriginalKey}`} />}
        </video>
      )}
      {t.videoKey && MEDIA_NOTE[t.mediaStatus] && (
        <p className="muted small" data-testid="media-status" data-status={t.mediaStatus}>
          {MEDIA_NOTE[t.mediaStatus]}
        </p>
      )}
      {t.videoKey && t.mediaStatus === "failed" && (
        <div className="row small" data-testid="media-status" data-status="failed">
          <span className="error-text">Video conversion failed: {t.mediaError ?? "unknown error"}. The original file is still served.</span>
          <button type="button" className="secondary small" onClick={onReprocess}>
            Try again
          </button>
        </div>
      )}
      {t.videoKey && (
        <TranscriptPanel t={t} enabled={transcription} onTranscribe={onTranscribe} onUpdate={onUpdate} />
      )}
      {t.rating ? <Stars rating={t.rating} /> : null}
      {t.text && <p className="quote" style={{ fontSize: "var(--text-lg)" }}>{t.text}</p>}

      <div className="edit">
        <label>
          Display name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Tags (comma separated)
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="homepage, pricing" />
        </label>
        <button
          type="button"
          className="secondary small"
          disabled={!dirty || !name.trim()}
          onClick={() =>
            onUpdate({
              authorName: name.trim(),
              tags: tags
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        >
          Save
        </button>
      </div>

      <div className="review-actions">
        {t.status !== "approved" && (
          <button type="button" className="approve small" onClick={() => onUpdate({ status: "approved" })}>
            <Icon name="check" />
            Approve
          </button>
        )}
        {t.status !== "rejected" && (
          <button type="button" className="secondary small" onClick={() => onUpdate({ status: "rejected" })}>
            <Icon name="close" />
            Reject
          </button>
        )}
        {t.status !== "pending" && (
          <button type="button" className="ghost small" onClick={() => onUpdate({ status: "pending" })}>
            <Icon name="undo" />
            Move to pending
          </button>
        )}
        <button type="button" className="danger small" onClick={onDelete}>
          <Icon name="trash" />
          Delete
        </button>
      </div>
    </article>
  );
}

const TRANSCRIPT_LABEL: Record<TranscriptStatus, string> = {
  none: "Not transcribed",
  queued: "Transcribing…",
  processing: "Transcribing…",
  ready: "Ready",
  failed: "Failed",
};

/** Machine transcript and WebVTT captions, both editable by the owner. */
function TranscriptPanel({
  t,
  enabled,
  onTranscribe,
  onUpdate,
}: {
  t: AdminTestimonial;
  enabled: boolean;
  onTranscribe: () => void;
  onUpdate: (patch: Record<string, unknown>) => Promise<void> | void;
}) {
  const [transcript, setTranscript] = useState(t.transcript ?? "");
  const [captions, setCaptions] = useState(t.captionsVtt ?? "");
  useEffect(() => {
    setTranscript(t.transcript ?? "");
    setCaptions(t.captionsVtt ?? "");
  }, [t.transcript, t.captionsVtt]);
  const dirty = transcript !== (t.transcript ?? "") || captions !== (t.captionsVtt ?? "");
  const busy = t.transcriptStatus === "queued" || t.transcriptStatus === "processing";

  return (
    <details className="transcript-editor" data-testid="transcript-panel" data-status={t.transcriptStatus}>
      <summary>
        Transcript &amp; captions <span className="muted xsmall">· {TRANSCRIPT_LABEL[t.transcriptStatus]}</span>
      </summary>
      <div className="stack" style={{ marginTop: "var(--space-3)" }}>
        {t.transcriptStatus === "failed" && (
          <p className="error-text small">Transcription failed: {t.transcriptError ?? "unknown error"}</p>
        )}
        {!enabled && (
          <p className="muted small">
            Automatic transcripts are off on this server (see <code>TRANSCRIBE_PROVIDER</code> in the README). You can
            still type a transcript or paste captions.
          </p>
        )}
        <label>
          Transcript
          <textarea rows={3} value={transcript} onChange={(e) => setTranscript(e.target.value)} />
        </label>
        <label>
          <span>
            Captions <span className="hint">(WebVTT or SRT)</span>
          </span>
          <textarea
            rows={4}
            className="mono"
            value={captions}
            onChange={(e) => setCaptions(e.target.value)}
            placeholder={"WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nHello!"}
          />
        </label>
        <div className="row">
          <button
            type="button"
            className="secondary small"
            disabled={!dirty}
            onClick={() => onUpdate({ transcript, captionsVtt: captions })}
          >
            Save transcript
          </button>
          {enabled && (
            <button type="button" className="ghost small" disabled={busy} onClick={onTranscribe}>
              {t.transcriptStatus === "none" ? "Transcribe" : "Transcribe again"}
            </button>
          )}
          {t.transcript && t.transcript !== t.text && (
            <button type="button" className="ghost small" onClick={() => onUpdate({ text: t.transcript })}>
              Use transcript as quote
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      <Icon name={copied ? "check" : "copy"} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function EmbedPanel({ slug, publicUrl }: { slug: string; publicUrl: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const link = `${publicUrl}/c/${slug}`;
  const script = `<script src="${publicUrl}/widget.js" data-project="${slug}" data-theme="${theme}" async></script>`;
  const iframe = `<iframe src="${publicUrl}/embed/${slug}?theme=${theme}" title="Testimonials" loading="lazy" style="width:100%;border:0;height:400px" id="plaudit-${slug}"></iframe>
<script>addEventListener("message",function(e){if(e.data&&e.data.type==="plaudit:resize"&&e.data.slug==="${slug}"){document.getElementById("plaudit-${slug}").style.height=e.data.height+"px"}})</script>`;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="row" style={{ fontSize: "var(--text-base)", gap: "var(--space-2)" }}>
          <Icon name="code" />
          Share &amp; embed
        </h2>
      </div>
      <div className="panel-body stack">
        <div className="field">
          Collection link
          <div className="link-field">
            <span>{link}</span>
            <CopyLink text={link} />
          </div>
        </div>
        <div className="row spread">
          <span className="small" style={{ fontWeight: 600 }}>
            Widget theme
          </span>
          <div className="segmented" role="group" aria-label="Widget theme">
            {(["light", "dark"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)}>
                {t === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          Script embed (recommended)
          <div className="snippet">
            <pre data-testid="script-snippet">{script}</pre>
            <CopyButton text={script} />
          </div>
          <span className="hint xsmall">
            Options: <code>data-tag</code>, <code>data-limit</code>, <code>data-layout=&quot;list&quot;</code>,{" "}
            <code>data-theme=&quot;auto&quot;</code>
          </span>
        </div>
        <div className="field">
          Iframe embed
          <div className="snippet">
            <pre data-testid="iframe-snippet">{iframe}</pre>
            <CopyButton text={iframe} />
          </div>
        </div>
      </div>
    </section>
  );
}

function CopyLink({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="secondary small"
      style={{ minHeight: 32 }}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      <Icon name={copied ? "check" : "copy"} />
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

function SettingsPanel({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const form = new FormData(e.currentTarget);
    try {
      const { project: saved } = await api<{ project: Project }>(`/api/admin/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.get("name"),
          prompt: form.get("prompt"),
          thankYouMessage: form.get("thankYouMessage"),
          accentColor: form.get("accentColor"),
          allowText: form.get("allowText") === "on",
          allowVideo: form.get("allowVideo") === "on",
          questions: form.get("questions"),
          maxVideoSeconds: Number(form.get("maxVideoSeconds")),
        }),
      });
      onSaved(saved);
      setMessage("Settings saved");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel" onSubmit={onSubmit}>
      <div className="panel-head">
        <h2 className="row" style={{ fontSize: "var(--text-base)", gap: "var(--space-2)" }}>
          <Icon name="sliders" />
          Collection page
        </h2>
      </div>
      <div className="panel-body stack">
        <label>
          Project name
          <input type="text" name="name" defaultValue={project.name} required />
        </label>
        <label>
          Question shown to customers
          <input type="text" name="prompt" defaultValue={project.prompt} required />
        </label>
        <label>
          Thank-you message
          <input type="text" name="thankYouMessage" defaultValue={project.thankYouMessage} required />
        </label>
        <label>
          <span>
            Questions <span className="hint">(one per line; shown beside the form and over the camera)</span>
          </span>
          <textarea name="questions" rows={4} defaultValue={project.questions} maxLength={1200} />
        </label>
        <label>
          Longest video (seconds)
          <input type="number" name="maxVideoSeconds" min={15} max={600} step={5} defaultValue={project.maxVideoSeconds} required />
        </label>
        <label className="row" style={{ flexDirection: "row", alignItems: "center", gap: "var(--space-3)" }}>
          <input type="color" name="accentColor" defaultValue={project.accentColor} />
          Brand colour
        </label>
        <label className="check">
          <input type="checkbox" name="allowText" defaultChecked={project.allowText} />
          Allow written testimonials
        </label>
        <label className="check">
          <input type="checkbox" name="allowVideo" defaultChecked={project.allowVideo} />
          Allow video testimonials
        </label>
        <div className="row">
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          {message && (
            <span className="muted small" role="status">
              {message}
            </span>
          )}
        </div>
      </div>
    </form>
  );
}
