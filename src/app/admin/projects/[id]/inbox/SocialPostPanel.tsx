"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { copyText } from "@/components/admin/clipboard";
import { Icon } from "@/components/Icon";
import type { SocialDraftView } from "@/lib/commerce/social";

/** Same numbers as src/lib/commerce/social.ts (kept here so this file stays client-only). */
const X_LIMIT = 280;
const X_LINK_LENGTH = 23;
const MAX = X_LIMIT - X_LINK_LENGTH - 1;

/**
 * INT-08: the approved testimonial's social post, for X and LinkedIn. Edit
 * it, copy it, or open each site's own share page with it; Plaudit never
 * posts anything itself. "Rewrite with AI" only when AI is on for the project.
 */
export function SocialPostPanel({ testimonialId }: { testimonialId: string }) {
  const [draft, setDraft] = useState<SocialDraftView | null>(null);
  const [ai, setAi] = useState(false);
  const [text, setText] = useState("");
  const [aiKept, setAiKept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const url = `/api/admin/testimonials/${testimonialId}/social-draft`;
  const box = useRef<HTMLElement>(null);

  const show = useCallback((d: SocialDraftView) => {
    setDraft(d);
    setText(d.text);
    setAiKept(false);
  }, []);
  useEffect(() => {
    api<{ draft: SocialDraftView; ai: boolean }>(url)
      .then((r) => {
        show(r.draft);
        setAi(r.ai);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [url, show]);

  async function run(fn: () => Promise<void>) {
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
  }

  if (!draft) {
    return error ? (
      <p className="error small" role="alert">
        {error}
      </p>
    ) : null;
  }
  const dirty = text.trim() !== draft.text;
  const left = MAX - text.trim().length;
  // Share links follow what's in the box, saved or not.
  const q = encodeURIComponent;
  const xUrl = `https://x.com/intent/tweet?text=${q(text.trim())}&url=${q(draft.url)}`;

  return (
    <section ref={box} className="ib-section stack" aria-labelledby="ib-social-title" data-testid="social-post">
      <h3 id="ib-social-title" className="ib-section-title">
        Social post
      </h3>
      <p className="muted xsmall">
        A draft for X and LinkedIn in {draft.edited ? "your words" : "the customer's own words"}, with a link to{" "}
        <a href={draft.url} target="_blank" rel="noopener">
          its page
        </a>
        . Plaudit never posts for you: copy it, or open the site&apos;s share page.
      </p>
      <label>
        <span className="visually-hidden">Post text</span>
        <textarea rows={5} value={text} maxLength={MAX + 40} onChange={(e) => setText(e.target.value)} data-testid="social-text" />
        <span className={left < 0 ? "error xsmall" : "muted xsmall"} data-testid="social-count">
          {left >= 0 ? `${left} characters left on X (the link counts as ${X_LINK_LENGTH})` : `${-left} characters over X's limit`}
        </span>
      </label>
      {draft.clip && (
        <p className="muted xsmall" data-testid="social-clip">
          This testimonial has a social clip.{" "}
          <a href={`/api/admin/renders/${draft.clip.renderId}/download`}>Download it</a> to add to the post.
        </p>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <p className="small" role="status" aria-live="polite">
        {status}
      </p>
      <div className="row">
        <button
          type="button"
          className="secondary small"
          disabled={busy || !dirty || left < 0 || !text.trim()}
          data-testid="social-save"
          onClick={() =>
            void run(async () => {
              const r = await api<{ draft: SocialDraftView }>(url, { method: "PUT", json: { text: text.trim(), aiRewritten: aiKept } });
              show(r.draft);
              setStatus("Saved.");
            })
          }
        >
          Save
        </button>
        <button
          type="button"
          className="ghost small"
          data-testid="social-copy"
          onClick={() =>
            void copyText(`${text.trim()}\n\n${draft.url}`, box.current).then((ok) => setStatus(ok ? "Copied the post and its link." : "Couldn't copy: select the text and copy it by hand."))
          }
        >
          <Icon name="copy" />
          Copy
        </button>
        <a className="button ghost small" href={xUrl} target="_blank" rel="noopener noreferrer" data-testid="share-x">
          <Icon name="external" />
          Post on X
        </a>
        <a className="button ghost small" href={draft.shareUrls.linkedin} target="_blank" rel="noopener noreferrer" data-testid="share-linkedin">
          <Icon name="external" />
          Share on LinkedIn
        </a>
        {ai && (
          <button
            type="button"
            className="ghost small"
            disabled={busy}
            data-testid="social-ai"
            onClick={() =>
              void run(async () => {
                const r = await api<{ suggestion: { text: string } }>(`${url}/rewrite`, { method: "POST" });
                setText(r.suggestion.text);
                setAiKept(true);
                setStatus("Rewritten with AI, quoting the customer word for word. Save to keep it.");
              })
            }
          >
            <Icon name="sparkle" />
            Rewrite with AI
          </button>
        )}
        {draft.edited && (
          <button
            type="button"
            className="ghost small"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await api<{ draft: SocialDraftView }>(url, { method: "DELETE" });
                show(r.draft);
                setStatus("Back to the template.");
              })
            }
          >
            <Icon name="undo" />
            Use the template
          </button>
        )}
      </div>
      <p className="muted xsmall">LinkedIn&apos;s share page takes the link only: copy the text first, then paste it there.</p>
    </section>
  );
}
