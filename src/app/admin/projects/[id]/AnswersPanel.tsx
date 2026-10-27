"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/app/admin/api";

type Answer = {
  id: string;
  questionKey: string;
  questionTitle: string;
  text: string | null;
  videoKey: string | null;
  videoOriginalKey: string | null;
  videoMime: string | null;
  posterKey: string | null;
  mediaStatus: string;
  transcript: string | null;
  captionsVtt: string | null;
};
type Detail = {
  answers: Answer[];
  images: { id: string; key: string; questionKey: string | null }[];
  feedback: { id: string; text: string }[];
  form: { id: string; name: string; isDefault: boolean } | null;
};

/** "utm_source" → "Utm source", for keys without a label of their own. */
const human = (key: string) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const show = (v: unknown) => (typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));

/** Loads once the card is on screen, so a long inbox doesn't ask for every card at once. */
function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

/** The other answers of a form submission (videos and transcripts included), its images, private feedback and fields. */
export function AnswersPanel({
  id,
  hasForm,
  primaryQuestion,
  custom,
  hidden,
  version,
}: {
  id: string;
  hasForm: boolean;
  primaryQuestion: string | null;
  custom: Record<string, unknown>;
  hidden: Record<string, unknown>;
  version: string | number | null;
}) {
  const [ref, seen] = useOnScreen<HTMLDivElement>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!seen || !hasForm) return;
    let live = true;
    api<Detail>(`/api/admin/testimonials/${id}/detail`)
      .then((d) => live && setDetail(d))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [id, seen, hasForm, version]);

  const customKeys = Object.keys(custom);
  const hiddenKeys = Object.keys(hidden);
  return (
    <div ref={ref} className="stack answers-panel" style={{ gap: "var(--space-3)" }} data-testid="testimonial-extras">
      {/* The default form's single-question cards stay as they always looked. */}
      {detail && (detail.answers.length > 0 || (detail.form && !detail.form.isDefault)) && (
        <p className="muted xsmall" style={{ margin: 0 }}>
          {detail.form && (
            <span className="badge" data-testid="form-badge">
              {detail.form.name}
            </span>
          )}{" "}
          {primaryQuestion && <span>Answering “{primaryQuestion}”</span>}
        </p>
      )}
      {detail && detail.answers.length > 0 && (
        <ol className="stack" style={{ gap: "var(--space-3)", margin: 0, paddingInlineStart: "1.2em" }} data-testid="answers">
          {detail.answers.map((a) => (
            <li key={a.id} data-question={a.questionKey}>
              <strong className="small">{a.questionTitle}</strong>
              {a.text && <p style={{ margin: "4px 0 0", whiteSpace: "pre-line" }}>{a.text}</p>}
              {a.videoKey && (
                <video controls preload="none" playsInline poster={a.posterKey ? `/api/media/${a.posterKey}` : undefined} style={{ marginTop: 6, maxWidth: "100%" }}>
                  <source src={`/api/media/${a.videoKey}`} type={a.mediaStatus === "ready" ? "video/mp4" : (a.videoMime ?? undefined)} />
                  {a.videoOriginalKey && a.videoOriginalKey !== a.videoKey && <source src={`/api/media/${a.videoOriginalKey}`} />}
                  {a.captionsVtt && <track kind="captions" src={`/api/captions/${id}?answer=${a.id}`} default label="Captions" />}
                </video>
              )}
              {a.videoKey && a.mediaStatus !== "ready" && a.mediaStatus !== "skipped" && (
                <p className="muted xsmall" data-status={a.mediaStatus}>
                  {a.mediaStatus === "failed" ? "The video couldn't be converted; the original is shown." : "Video still processing…"}
                </p>
              )}
              {a.transcript && <p className="muted small" style={{ margin: "4px 0 0" }}>Transcript: {a.transcript}</p>}
            </li>
          ))}
        </ol>
      )}
      {detail && detail.images.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }} data-testid="answer-images">
          {detail.images.map((img) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={img.id} src={`/api/media/${img.key}`} alt="" width={72} height={72} style={{ objectFit: "cover", borderRadius: 8 }} />
          ))}
        </div>
      )}
      {detail && detail.feedback.length > 0 && (
        <div className="notice small" data-testid="private-feedback">
          <strong>Private feedback</strong> (never published)
          {detail.feedback.map((f) => (
            <p key={f.id} style={{ margin: "4px 0 0", whiteSpace: "pre-line" }}>
              {f.text}
            </p>
          ))}
        </div>
      )}
      {(customKeys.length > 0 || hiddenKeys.length > 0) && (
        <dl className="small" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "2px var(--space-3)", margin: 0 }} data-testid="form-fields">
          {customKeys.map((k) => (
            <div key={`c:${k}`} style={{ display: "contents" }} data-field={k}>
              <dt className="muted">{human(k)}</dt>
              <dd style={{ margin: 0 }}>{show(custom[k])}</dd>
            </div>
          ))}
          {hiddenKeys.map((k) => (
            <div key={`h:${k}`} style={{ display: "contents" }} data-hidden={k}>
              <dt className="muted">{k} (from the link)</dt>
              <dd style={{ margin: 0 }}>{show(hidden[k])}</dd>
            </div>
          ))}
        </dl>
      )}
      {error && <p className="error-text xsmall">{error}</p>}
    </div>
  );
}
