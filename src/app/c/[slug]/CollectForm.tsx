"use client";

import { useState } from "react";
import { VideoRecorder } from "./VideoRecorder";

type Props = {
  project: { slug: string; name: string; prompt: string; allowVideo: boolean; allowText: boolean };
};

type Mode = "text" | "video";

export function CollectForm({ project }: Props) {
  const [mode, setMode] = useState<Mode>(project.allowText ? "text" : "video");
  const [rating, setRating] = useState(0);
  const [video, setVideo] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    if (rating) form.set("rating", String(rating));
    if (mode === "video") {
      form.delete("text");
      if (!video) {
        setError("Please record or upload a video first");
        return;
      }
      const ext = video.type.includes("mp4") ? "mp4" : video.type.includes("quicktime") ? "mov" : "webm";
      form.set("video", video, `testimonial.${ext}`);
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${project.slug}/testimonials`, {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Something went wrong, please try again");
      setDone(body.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="card stack" role="status">
        <h1>🎉 {done}</h1>
        <p className="muted">You can close this page now.</p>
      </div>
    );
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <div>
        <p className="muted small" style={{ margin: 0 }}>
          {project.name}
        </p>
        <h1 style={{ marginTop: 4 }}>{project.prompt}</h1>
      </div>

      <div>
        <span style={{ fontWeight: 500 }}>Your rating</span>
        <div className="row star-input" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              data-on={n <= rating}
              onClick={() => setRating(n === rating ? 0 : n)}
            >
              ★
            </button>
          ))}
        </div>
      </div>

      {project.allowText && project.allowVideo && (
        <div className="tabs" role="group" aria-label="Testimonial type">
          <button type="button" aria-pressed={mode === "text"} onClick={() => setMode("text")}>
            Write
          </button>
          <button type="button" aria-pressed={mode === "video"} onClick={() => setMode("video")}>
            Video
          </button>
        </div>
      )}

      {mode === "text" ? (
        <label>
          Your testimonial
          <textarea name="text" required maxLength={5000} placeholder="What did you like most?" />
        </label>
      ) : (
        <VideoRecorder onChange={setVideo} />
      )}

      <label>
        Your name
        <input type="text" name="name" required maxLength={120} autoComplete="name" />
      </label>
      <label>
        <span>
          Email <span className="muted small">(private, never shown publicly)</span>
        </span>
        <input type="email" name="email" maxLength={254} autoComplete="email" />
      </label>
      <div className="row" style={{ alignItems: "stretch" }}>
        <label style={{ flex: 1, minWidth: 180 }}>
          Role / title
          <input type="text" name="title" maxLength={120} autoComplete="organization-title" />
        </label>
        <label style={{ flex: 1, minWidth: 180 }}>
          Company
          <input type="text" name="company" maxLength={120} autoComplete="organization" />
        </label>
      </div>
      <label>
        <span>
          Photo <span className="muted small">(optional)</span>
        </span>
        <input type="file" name="avatar" accept="image/png,image/jpeg,image/webp,image/gif" />
      </label>

      {/* Honeypot for bots; hidden from people and assistive tech. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        style={{ position: "absolute", left: "-9999px" }}
      />

      <label className="checkbox">
        <input type="checkbox" name="consent" required />
        <span>
          I agree that {project.name} may publish this testimonial, with my name, photo and
          video, on its website and marketing.
        </span>
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={submitting}>
        {submitting ? "Sending…" : "Submit testimonial"}
      </button>
    </form>
  );
}
