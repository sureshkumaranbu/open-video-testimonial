"use client";

import { useState } from "react";
import type { ThankYou as ThankYouContent } from "@/lib/forms/engine";
import { fillLabel, type Labels } from "@/lib/forms/labels";

type Props = {
  content: ThankYouContent;
  labels: Labels;
  projectName: string;
  /** What they wrote, for "copy my words" and the share links. */
  words: string;
  /** Share links appear only when they agreed to social use (FORM-16). */
  social: boolean;
  withdrawUrl?: string | null;
};

const SHARE = [
  { network: "X", url: (text: string) => `https://x.com/intent/post?text=${encodeURIComponent(text)}` },
  { network: "LinkedIn", url: (text: string) => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}` },
  { network: "Facebook", url: (text: string) => `https://www.facebook.com/sharer/sharer.php?quote=${encodeURIComponent(text)}` },
];

/** After sending: thanks, their words to copy or share, the owner's link, and the private withdraw link. */
export function ThankYou({ content, labels: l, projectName, words, social, withdrawUrl }: Props) {
  const [copied, setCopied] = useState<"words" | "link" | null>(null);
  const t = (s: string) => fillLabel(s, { project: projectName });
  const quote = words.trim();
  const copy = async (text: string, what: "words" | "link") => {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      // Clipboard blocked (an embed without the permission): the text is still on screen to copy by hand.
    }
    setCopied(what);
  };
  return (
    <div className="fr-thanks" role="status" data-testid="thank-you">
      <span className="done-mark" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      <h1>{t(content.title || l.thankYouTitle)}</h1>
      <p className="fr-sub">{t(content.message || l.thankYouMessage)}</p>
      {content.cta && (
        <a className="button accent fr-primary" href={content.cta.url} target="_blank" rel="noopener noreferrer">
          {content.cta.label}
        </a>
      )}
      {content.copyText && quote && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="fr-sub small">{l.copyHint}</p>
          <blockquote className="fr-quote" data-testid="my-words">
            {quote}
          </blockquote>
          <div>
            <button type="button" className="secondary small" onClick={() => copy(quote, "words")}>
              {copied === "words" ? l.copied : l.copyWords}
            </button>
          </div>
        </div>
      )}
      {content.share && social && quote && (
        <div className="stack" style={{ gap: 8 }}>
          <strong>{l.shareTitle}</strong>
          <div className="fr-share">
            {SHARE.map((s) => (
              <a key={s.network} className="button secondary small" href={s.url(quote)} target="_blank" rel="noopener noreferrer">
                {fillLabel(l.shareOn, { network: s.network })}
              </a>
            ))}
          </div>
        </div>
      )}
      {withdrawUrl && (
        <div className="withdraw-note" data-testid="withdraw-note">
          <p className="small">{l.withdrawNote}</p>
          <div className="link-field">
            <span>{withdrawUrl}</span>
            <button type="button" className="secondary small" onClick={() => copy(withdrawUrl, "link")}>
              {copied === "link" ? l.copied : l.copyLink}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
