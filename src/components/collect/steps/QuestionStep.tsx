"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import type { QuestionPage } from "@/lib/forms/schema";
import { isImageMime, sniffMime } from "@/lib/sniff";
import { VideoRecorder } from "../VideoRecorder";
import type { StepCtx } from "./types";

/** Picked images as thumbnails; object URLs are released when they change. */
function Thumbs({ files, onRemove, label }: { files: File[]; onRemove: (i: number) => void; label: string }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const made = files.map((f) => URL.createObjectURL(f));
    setUrls(made);
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  return (
    <>
      {urls.map((u, i) => (
        <figure key={u}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u} alt="" />
          <button type="button" className="secondary small" aria-label={label} onClick={() => onRemove(i)}>
            ×
          </button>
        </figure>
      ))}
    </>
  );
}

/** One question (FORM-04/05): written, recorded or either, with tips, an optional skip and up to 3 images. */
export function QuestionStep({ page, ctx }: { page: QuestionPage; ctx: StepCtx }) {
  const { state, update, errors, labels: l, form } = ctx;
  const answer = state.answers[page.key];
  const mode = page.mode === "video_text" ? answer?.mode ?? "text" : page.mode;
  const error = errors[`q:${page.key}`];
  const images = ctx.files.images[page.key] ?? [];
  const [imageProblem, setImageProblem] = useState<string | null>(null);
  const setAnswer = (patch: Partial<NonNullable<typeof answer>>) =>
    update((s) => ({ ...s, answers: { ...s.answers, [page.key]: { ...s.answers[page.key], ...patch } } }));
  const subtitle = mode === "video" && page.videoSubtitle ? page.videoSubtitle : page.subtitle;

  return (
    <>
      <h1>
        {page.title} {!page.required && <span className="fr-optional">{l.optional}</span>}
      </h1>
      {subtitle && <p className="fr-sub">{subtitle}</p>}
      {page.tips.length > 0 && (
        <ul className="fr-tips" aria-label={l.tipsLabel}>
          {page.tips.map((tip, i) => (
            <li key={i}>{tip}</li>
          ))}
        </ul>
      )}
      {page.mode === "video_text" && (
        <div className="segmented" role="group" aria-label={l.answerType}>
          <button type="button" aria-pressed={mode === "text"} onClick={() => setAnswer({ mode: "text" })}>
            <Icon name="pen" />
            {l.answerWrite}
          </button>
          <button type="button" aria-pressed={mode === "video"} onClick={() => setAnswer({ mode: "video" })}>
            <Icon name="video" />
            {l.answerVideo}
          </button>
        </div>
      )}
      {mode === "text" ? (
        <label>
          <span className="visually-hidden">{l.yourAnswer}</span>
          <textarea
            value={answer?.text ?? ""}
            maxLength={5000}
            placeholder={l.textPlaceholder}
            aria-invalid={Boolean(error)}
            onChange={(e) => setAnswer({ text: e.target.value })}
          />
        </label>
      ) : ctx.preview ? (
        <div className="fr-video-placeholder" data-testid="video-placeholder">
          {l.recRecordWithCamera}
        </div>
      ) : (
        <>
          {form.settings.landscapePrompt && <p className="fr-sub small">{l.landscapeHint}</p>}
          <VideoRecorder
            key={page.key}
            slug={ctx.project.slug}
            questions={page.tips}
            maxSeconds={page.maxVideoSeconds}
            maxBytes={ctx.limits.maxVideoBytes}
            upload={ctx.uploads.get(page.key)}
            abortOnUnmount={false}
            labels={l}
            onChange={(video) => setAnswer({ hasVideo: Boolean(video) })}
          />
        </>
      )}
      {page.allowImages > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="fr-images">
            <Thumbs
              files={images}
              label={l.removeImage}
              onRemove={(i) => ctx.setFiles((f) => ({ ...f, images: { ...f.images, [page.key]: images.filter((_, j) => j !== i) } }))}
            />
            {images.length < page.allowImages && !ctx.preview && (
              <label className="button secondary small" style={{ flexDirection: "row" }}>
                <Icon name="image" />
                {l.addImages}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  style={{ display: "none" }}
                  data-testid={`images-${page.key}`}
                  onChange={async (e) => {
                    const picked = [...(e.target.files ?? [])];
                    e.target.value = "";
                    setImageProblem(null);
                    const ok: File[] = [];
                    for (const file of picked) {
                      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
                      if (file.size > ctx.limits.maxImageBytes) setImageProblem(ctx.t("fileTooLarge", { mb: Math.round(ctx.limits.maxImageBytes / 1024 / 1024) }));
                      else if (!isImageMime(sniffMime(head))) setImageProblem(l.photoUnsupported);
                      else ok.push(file);
                    }
                    ctx.setFiles((f) => ({ ...f, images: { ...f.images, [page.key]: [...images, ...ok].slice(0, page.allowImages) } }));
                    setAnswer({ images: Math.min(page.allowImages, images.length + ok.length) });
                  }}
                />
              </label>
            )}
          </div>
          <span className="fr-sub xsmall">{ctx.t("imagesHint", { n: page.allowImages })}</span>
          {imageProblem && (
            <span className="fr-error" role="alert">
              {imageProblem}
            </span>
          )}
        </div>
      )}
      {error && (
        <p className="fr-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
