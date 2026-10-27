"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { Drawer } from "@/components/admin";
import { Icon } from "@/components/Icon";
import { Stars } from "@/components/TestimonialCard";
import { formatSourceDate } from "@/lib/dates";
import { ConsentPanel, timeAgo, type AdminTestimonial } from "../Dashboard";
import { EditForm, type EditableTestimonial } from "./EditForm";
import { HighlightEditor, type HighlightJson } from "./HighlightEditor";
import { sourceLabel, type InboxRow } from "./types";

type DetailAnswer = {
  id: string;
  questionKey: string;
  questionTitle: string;
  text: string | null;
  videoKey: string | null;
  videoOriginalKey: string | null;
  videoMime: string | null;
  posterKey: string | null;
  mediaStatus: string;
  captionsVtt: string | null;
  transcript: string | null;
};
type HistoryJson = { id: string; actor: string; actorEmail: string | null; action: string; diff: Record<string, [unknown, unknown]>; createdAt: string };
type Detail = {
  testimonial: InboxRow & EditableTestimonial;
  answers: DetailAnswer[];
  images: { id: string; key: string; questionKey: string | null }[];
  highlights: HighlightJson[];
  history: HistoryJson[];
  feedback: { id: string; text: string }[];
  form: { id: string; name: string; isDefault: boolean } | null;
};

const STATUS_TEXT: Record<string, string> = { pending: "Pending", approved: "Approved", hidden: "Hidden", rejected: "Rejected", trashed: "In the trash" };
const ACTION_TEXT: Record<string, string> = {
  created: "Added",
  edited: "Edited",
  status: "Status changed",
  tags: "Tags changed",
  trashed: "Moved to the trash",
  restored: "Restored",
  answer_edited: "Answer edited",
  highlights: "Highlights changed",
  bulk: "Changed in bulk",
};
const FIELD_TEXT: Record<string, string> = {
  authorName: "name",
  authorTitle: "job title",
  authorCompany: "company",
  authorWebsite: "website",
  text: "text",
  headline: "headline",
  rating: "rating",
  sourceDate: "date posted",
  sourceUrl: "source link",
  platform: "source platform",
  language: "language",
  transcript: "transcript",
  captionsVtt: "captions",
  avatarKey: "photo",
  companyLogoKey: "company logo",
};

function describe(h: HistoryJson) {
  if (h.action === "status" || h.action === "trashed" || h.action === "restored") {
    const [from, to] = h.diff.status ?? [];
    return from && to ? `${STATUS_TEXT[String(from)] ?? from} → ${STATUS_TEXT[String(to)] ?? to}` : "";
  }
  if (h.action === "tags") {
    const [, to] = h.diff.tags ?? [];
    return Array.isArray(to) ? (to.length ? to.join(", ") : "no tags") : "";
  }
  if (h.action === "answer_edited") return Object.keys(h.diff).map((k) => k.replace(/^answer:/, "answer ")).join(", ");
  if (h.action === "edited") return Object.keys(h.diff).map((k) => FIELD_TEXT[k] ?? k).join(", ");
  return "";
}

const human = (key: string) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
function readJson(raw: string | null | undefined): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
const show = (v: unknown) => (typeof v === "boolean" ? (v ? "Yes" : "No") : v == null ? "" : String(v));

/** Keys that belong to typing, not to the drawer's shortcuts. */
function typing(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * One testimonial in full (INBOX-07): every answer with its video and
 * captions, images, custom and hidden fields, source, consent record,
 * highlights, the editor and the history. Keys: j next, k previous,
 * a approve, h hide.
 */
export function DetailDrawer({
  id,
  position,
  onClose,
  onPrev,
  onNext,
  onChanged,
}: {
  id: string | null;
  position: { index: number; count: number } | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onChanged: () => void;
  tags: string[];
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await api<Detail>(`/api/admin/testimonials/${id}/detail`);
      setDetail(d);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    setEditing(false);
    if (!id) {
      setDetail(null);
      return;
    }
    void load();
  }, [id, load]);

  const setStatus = useCallback(
    async (status: string) => {
      if (!id) return;
      try {
        await api(`/api/admin/testimonials/${id}`, { method: "PATCH", json: { status } });
        await load();
        onChanged();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [id, load, onChanged],
  );

  const post = async (path: string) => {
    if (!id) return;
    try {
      await api(`/api/admin/testimonials/${id}/${path}`, { method: "POST" });
      await load();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const t = detail?.testimonial;
  const ready = Boolean(t && t.id === id);

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || editing) return;
      if (e.key === "j" && onNext) {
        e.preventDefault();
        onNext();
      } else if (e.key === "k" && onPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === "a" && ready && t && t.status !== "approved" && t.status !== "trashed") {
        e.preventDefault();
        void setStatus("approved");
      } else if (e.key === "h" && ready && t && t.status !== "hidden" && t.status !== "trashed") {
        e.preventDefault();
        void setStatus("hidden");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [id, onNext, onPrev, ready, t, setStatus, editing]);

  const custom = readJson(t?.customFields);
  const hidden = readJson(t?.hiddenFields);
  const trashed = t?.status === "trashed";

  return (
    <Drawer
      open={Boolean(id)}
      onClose={onClose}
      title={t && ready ? t.authorName : "Testimonial"}
      width="lg"
      testId="detail-drawer"
      description={position ? `${position.index + 1} of ${position.count} on this page · j and k move, a approves, h hides` : "a approves, h hides"}
      headerActions={
        <>
          <button type="button" className="ghost small" onClick={onPrev} disabled={!onPrev} aria-label="Previous testimonial" title="Previous (k)">
            ‹ Prev
          </button>
          <button type="button" className="ghost small" onClick={onNext} disabled={!onNext} aria-label="Next testimonial" title="Next (j)">
            Next ›
          </button>
        </>
      }
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!ready && !error && <p className="muted">Loading…</p>}
      {ready && t && detail && (
        <div className="stack ib-detail" data-testid="detail" data-status={t.status} data-id={t.id}>
          <div className="row ib-badges">
            <span className={`badge ${t.withdrawnAt ? "rejected" : t.status}`} data-testid="detail-status">
              {t.withdrawnAt ? "Withdrawn" : STATUS_TEXT[t.status]}
            </span>
            {t.editedAfterConsent && (
              <span className="badge edited" data-testid="edited-badge" title="You changed what the author wrote after they consented">
                Edited after consent
              </span>
            )}
            {detail.form && <span className="badge">{detail.form.name}</span>}
            <span className="muted xsmall">Added {timeAgo(t.createdAt)}</span>
          </div>

          <div className="row ib-detail-actions">
            {trashed ? (
              <button type="button" className="secondary small" onClick={() => void post("restore")}>
                <Icon name="restore" />
                Restore
              </button>
            ) : (
              <>
                {t.status !== "approved" && !t.withdrawnAt && (
                  <button type="button" className="approve small" onClick={() => void setStatus("approved")} aria-keyshortcuts="a">
                    <Icon name="check" />
                    Approve
                  </button>
                )}
                {t.status !== "hidden" && !t.withdrawnAt && (
                  <button type="button" className="secondary small" onClick={() => void setStatus("hidden")} aria-keyshortcuts="h">
                    <Icon name="lock" />
                    Hide
                  </button>
                )}
                {t.status !== "rejected" && (
                  <button type="button" className="secondary small" onClick={() => void setStatus("rejected")}>
                    <Icon name="close" />
                    Reject
                  </button>
                )}
                {t.status !== "pending" && !t.withdrawnAt && (
                  <button type="button" className="ghost small" onClick={() => void setStatus("pending")}>
                    <Icon name="undo" />
                    Move to pending
                  </button>
                )}
                <button type="button" className="ghost small" onClick={() => setEditing((e) => !e)} aria-expanded={editing} data-testid="edit-toggle">
                  <Icon name="pen" />
                  Edit
                </button>
                <button
                  type="button"
                  className="danger small"
                  onClick={() => confirm("Move this testimonial to the trash? You can restore it for 30 days.") && void post("trash")}
                >
                  <Icon name="trash" />
                  Move to trash
                </button>
              </>
            )}
          </div>

          {editing ? (
            <EditForm
              t={t}
              answers={detail.answers}
              onCancel={() => setEditing(false)}
              onImagesChanged={() => {
                void load();
                onChanged();
              }}
              onSaved={() => {
                setEditing(false);
                void load();
                onChanged();
              }}
            />
          ) : (
            <>
              <div className="ib-person small">
                {[t.authorTitle, t.authorCompany].filter(Boolean).join(", ")}
                {t.authorEmail && <div className="muted">{t.authorEmail}</div>}
                {t.authorWebsite && (
                  <a href={t.authorWebsite} target="_blank" rel="noreferrer noopener">
                    {t.authorWebsite}
                  </a>
                )}
              </div>
              {t.rating ? <Stars rating={t.rating} /> : null}
              {t.headline && <p className="ib-headline">{t.headline}</p>}
              {t.videoKey && (
                <video controls preload="metadata" playsInline poster={t.posterKey ? `/api/media/${t.posterKey}` : undefined} key={t.videoKey}>
                  <source src={`/api/media/${t.videoKey}`} type={t.mediaStatus === "ready" ? "video/mp4" : (t.videoMime ?? undefined)} />
                  {t.videoOriginalKey && t.videoOriginalKey !== t.videoKey && <source src={`/api/media/${t.videoOriginalKey}`} />}
                  {t.captionsVtt && <track kind="captions" src={`/api/captions/${t.id}`} default label="Captions" />}
                </video>
              )}
              <HighlightEditor
                key={t.id}
                testimonialId={t.id}
                blocks={[
                  { answerId: null, title: t.primaryQuestion ?? "Testimonial", text: t.text ?? "" },
                  ...detail.answers.map((a) => ({ answerId: a.id, title: a.questionTitle, text: a.text ?? "" })),
                ]}
                highlights={detail.highlights}
                onSaved={() => {
                  void load();
                  onChanged();
                }}
              />
              {detail.answers.some((a) => a.videoKey) && (
                <section className="stack ib-section">
                  <h3 className="ib-section-title">Answer videos</h3>
                  {detail.answers
                    .filter((a) => a.videoKey)
                    .map((a) => (
                      <figure key={a.id} className="ib-answer-video">
                        <figcaption className="muted xsmall">{a.questionTitle}</figcaption>
                        <video controls preload="none" playsInline poster={a.posterKey ? `/api/media/${a.posterKey}` : undefined}>
                          <source src={`/api/media/${a.videoKey}`} type={a.mediaStatus === "ready" ? "video/mp4" : (a.videoMime ?? undefined)} />
                          {a.videoOriginalKey && a.videoOriginalKey !== a.videoKey && <source src={`/api/media/${a.videoOriginalKey}`} />}
                          {a.captionsVtt && <track kind="captions" src={`/api/captions/${t.id}?answer=${a.id}`} default label="Captions" />}
                        </video>
                      </figure>
                    ))}
                </section>
              )}
              {detail.images.length > 0 && (
                <section className="ib-section">
                  <h3 className="ib-section-title">Images</h3>
                  <div className="row ib-images">
                    {detail.images.map((img) => (
                      <a key={img.id} href={`/api/media/${img.key}`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/media/${img.key}`} alt="Attached image" width={96} height={96} />
                      </a>
                    ))}
                  </div>
                </section>
              )}
              {(Object.keys(custom).length > 0 || Object.keys(hidden).length > 0) && (
                <section className="ib-section">
                  <h3 className="ib-section-title">Fields</h3>
                  <dl className="ib-fields small">
                    {Object.entries(custom).map(([k, val]) => (
                      <div key={`c:${k}`} data-field={k}>
                        <dt className="muted">{human(k)}</dt>
                        <dd>{show(val)}</dd>
                      </div>
                    ))}
                    {Object.entries(hidden).map(([k, val]) => (
                      <div key={`h:${k}`} data-hidden={k}>
                        <dt className="muted">{k} (from the link)</dt>
                        <dd>{show(val)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              {detail.feedback.length > 0 && (
                <div className="notice small">
                  <strong>Private feedback</strong> (never published)
                  {detail.feedback.map((f) => (
                    <p key={f.id} style={{ margin: "4px 0 0", whiteSpace: "pre-line" }}>
                      {f.text}
                    </p>
                  ))}
                </div>
              )}
              <section className="ib-section">
                <h3 className="ib-section-title">Source</h3>
                <p className="small" data-testid="detail-source">
                  {sourceLabel(t)}
                  {t.sourceDate && <> · posted {formatSourceDate(new Date(t.sourceDate), t.datePrecision, "en")}</>}
                  {t.language && <> · {t.language}</>}
                  {t.sourceUrl && (
                    <>
                      {" · "}
                      <a href={t.sourceUrl} target="_blank" rel="noreferrer noopener">
                        View the original
                      </a>
                    </>
                  )}
                </p>
                {t.tags.length > 0 && <p className="muted xsmall">Tags: {t.tags.join(", ")}</p>}
              </section>
            </>
          )}

          <ConsentPanel t={t as AdminTestimonial} />

          <section className="ib-section" aria-labelledby="ib-history-title">
            <h3 id="ib-history-title" className="ib-section-title">
              History
            </h3>
            <ol className="ib-history" data-testid="history">
              {[...detail.history].reverse().map((h) => (
                <li key={h.id} data-action={h.action}>
                  <strong className="small">{ACTION_TEXT[h.action] ?? h.action}</strong> <span className="small">{describe(h)}</span>
                  <div className="muted xsmall">
                    {new Date(h.createdAt).toLocaleString()} · {h.actorEmail ?? h.actor}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Drawer>
  );
}
