"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { type RecordedVideo, VideoRecorder } from "./VideoRecorder";

type Props = {
  project: {
    slug: string;
    name: string;
    allowVideo: boolean;
    allowText: boolean;
    questions: string[];
    maxVideoSeconds: number;
  };
  /** The exact consent wording shown, and its stored version. */
  consent: { versionId: string; text: string };
  /** From a personal request link. */
  prefill?: { token: string; name: string; email: string; company: string } | null;
};

type Mode = "text" | "video";

const RATING_WORDS = ["", "Poor", "Fair", "Good", "Great", "Outstanding"];

function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="row" style={{ gap: "var(--space-3)" }}>
      <div
        className="star-input"
        role="radiogroup"
        aria-label="Rating"
        data-hover={hover ? "" : undefined}
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            data-on={!hover && n <= value}
            data-hover-on={n <= hover}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n === value ? 0 : n)}
          >
            <Icon name="star" />
          </button>
        ))}
      </div>
      <span className="muted small" aria-live="polite">
        {RATING_WORDS[shown]}
      </span>
    </div>
  );
}

function PhotoPicker() {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);
  return (
    <label className="file-pick" style={{ position: "relative" }}>
      <span className="preview" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview ? <img src={preview} alt="" /> : <Icon name="upload" />}
      </span>
      <span className="stack" style={{ gap: 2 }}>
        <span>
          Photo <span className="hint">(optional)</span>
        </span>
        <span className="hint xsmall">{preview ? "Looks good. Click to change it." : "A headshot or your logo, under 5 MB"}</span>
      </span>
      <input
        type="file"
        name="avatar"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => {
          const file = e.target.files?.[0];
          setPreview(file ? URL.createObjectURL(file) : null);
        }}
      />
    </label>
  );
}

export function CollectForm({ project, consent, prefill }: Props) {
  const [mode, setMode] = useState<Mode>(project.allowText ? "text" : "video");
  const [rating, setRating] = useState(0);
  const [video, setVideo] = useState<RecordedVideo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ message: string; withdrawUrl?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    if (rating) form.set("rating", String(rating));
    if (mode === "video") {
      form.delete("text");
      if (!video) {
        setError("Record or upload a video before sending.");
        return;
      }
    }
    setSubmitting(true);
    try {
      if (mode === "video" && video) {
        // Usually already done: the video uploads while it records.
        const { id, token } = await video.upload.finish();
        form.set("videoUpload", id);
        form.set("videoUploadToken", token);
      }
      const res = await fetch(`/api/projects/${project.slug}/testimonials`, {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Your testimonial didn't send. Check your connection and try again.");
      setDone({ message: body.message, withdrawUrl: body.withdrawUrl });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="done" role="status">
        <span className="done-mark" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <h2 style={{ fontSize: "var(--text-2xl)" }}>{done.message}</h2>
        <p className="muted">
          {project.name} will review it shortly. You can close this page.
        </p>
        {done.withdrawUrl && (
          <div className="withdraw-note" data-testid="withdraw-note">
            <p className="small">
              Changed your mind later? This private link lets you withdraw your testimonial at any time. Keep it
              somewhere safe; anyone with it can withdraw.
            </p>
            <div className="link-field">
              <span>{done.withdrawUrl}</span>
              <button
                type="button"
                className="secondary small"
                onClick={async () => {
                  await navigator.clipboard?.writeText(done.withdrawUrl!);
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <form className="collect-form" onSubmit={onSubmit}>
      <section className="form-section" aria-labelledby="s-rating">
        <h2 id="s-rating" className="section-title">
          How was your experience?
        </h2>
        <StarInput value={rating} onChange={setRating} />
      </section>

      <section className="form-section" aria-labelledby="s-story">
        <div className="row spread">
          <h2 id="s-story" className="section-title">
            Your story
          </h2>
          {project.allowText && project.allowVideo && (
            <div className="segmented" role="group" aria-label="Testimonial type">
              <button type="button" aria-pressed={mode === "text"} onClick={() => setMode("text")}>
                <Icon name="pen" />
                Write
              </button>
              <button type="button" aria-pressed={mode === "video"} onClick={() => setMode("video")}>
                <Icon name="video" />
                Video
              </button>
            </div>
          )}
        </div>
        {mode === "text" ? (
          <label>
            <span className="visually-hidden">Your testimonial</span>
            <textarea
              name="text"
              required
              maxLength={5000}
              placeholder="Tell it like you'd tell a friend. What made the difference?"
            />
          </label>
        ) : (
          <VideoRecorder
            slug={project.slug}
            questions={project.questions}
            maxSeconds={project.maxVideoSeconds}
            onChange={setVideo}
          />
        )}
      </section>

      <section className="form-section" aria-labelledby="s-you">
        <h2 id="s-you" className="section-title">
          About you
        </h2>
        <label>
          Your name
          <input type="text" name="name" required maxLength={120} autoComplete="name" defaultValue={prefill?.name} />
        </label>
        <label>
          <span>
            Email <span className="hint">(private, never shown publicly)</span>
          </span>
          <input type="email" name="email" maxLength={254} autoComplete="email" defaultValue={prefill?.email} />
        </label>
        <div className="two-col">
          <label>
            Role / title
            <input type="text" name="title" maxLength={120} autoComplete="organization-title" />
          </label>
          <label>
            Company
            <input type="text" name="company" maxLength={120} autoComplete="organization" defaultValue={prefill?.company} />
          </label>
        </div>
        <PhotoPicker />
      </section>

      {/* Honeypot for bots; hidden from people and assistive tech. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        style={{ position: "absolute", left: "-9999px" }}
      />

      <input type="hidden" name="consentVersion" value={consent.versionId} />
      {prefill && <input type="hidden" name="requestToken" value={prefill.token} />}
      <label className="check consent">
        <input type="checkbox" name="consent" required />
        <span data-testid="consent-text">{consent.text}</span>
      </label>
      <label className="check consent-extra">
        <input type="checkbox" name="consentSocial" />
        <span>
          {project.name} may also share it on social media. <span className="hint">(optional)</span>
        </span>
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="accent lg block" disabled={submitting}>
        {submitting ? (mode === "video" ? "Finishing upload…" : "Sending…") : "Submit testimonial"}
      </button>
    </form>
  );
}
