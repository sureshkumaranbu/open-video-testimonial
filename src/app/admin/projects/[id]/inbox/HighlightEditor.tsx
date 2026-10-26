"use client";

import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { Icon } from "@/components/Icon";

export type HighlightJson = { id: string; answerId: string | null; start: number; end: number; phrase: string };
export type TextBlock = { answerId: string | null; title: string; text: string };

type Pending = { answerId: string | null; start: number; end: number; phrase: string };

/** Where a DOM position falls in a block's plain text. */
function offsetIn(block: HTMLElement, node: Node, offset: number) {
  const r = document.createRange();
  r.selectNodeContents(block);
  r.setEnd(node, offset);
  return r.toString().length;
}

/** A block's text with its highlights marked. */
function Marked({ text, marks }: { text: string; marks: HighlightJson[] }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const h of [...marks].sort((a, b) => a.start - b.start)) {
    if (h.start < at || h.end > text.length) continue;
    if (h.start > at) parts.push(text.slice(at, h.start));
    parts.push(<mark key={h.id}>{text.slice(h.start, h.end)}</mark>);
    at = h.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * Every answer's text, with highlighted phrases marked (INBOX-08). Select
 * words in any block, then "Highlight selection"; widgets and walls can
 * emphasise them. The selection is remembered until it's used, because
 * clicking the button can clear it in some browsers.
 */
export function HighlightEditor({
  testimonialId,
  blocks,
  highlights,
  onSaved,
}: {
  testimonialId: string;
  blocks: TextBlock[];
  highlights: HighlightJson[];
  onSaved: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onSelect = () => {
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !root.current) return;
      const range = sel.getRangeAt(0);
      const startBlock = (range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement)?.closest<HTMLElement>("[data-hl-block]");
      const endBlock = (range.endContainer.nodeType === 1 ? (range.endContainer as Element) : range.endContainer.parentElement)?.closest<HTMLElement>("[data-hl-block]");
      if (!startBlock || startBlock !== endBlock || !root.current.contains(startBlock)) return;
      const text = startBlock.textContent ?? "";
      let start = offsetIn(startBlock, range.startContainer, range.startOffset);
      let end = offsetIn(startBlock, range.endContainer, range.endOffset);
      // Leave out spaces at either end of the selection.
      while (start < end && /\s/.test(text[start])) start++;
      while (end > start && /\s/.test(text[end - 1])) end--;
      if (end <= start) return;
      const answerId = startBlock.dataset.hlBlock === "main" ? null : (startBlock.dataset.hlBlock ?? null);
      setPending({ answerId, start, end, phrase: text.slice(start, end) });
      setError(null);
    };
    document.addEventListener("selectionchange", onSelect);
    return () => document.removeEventListener("selectionchange", onSelect);
  }, []);

  async function save(list: { answerId: string | null; start: number; end: number }[]) {
    setSaving(true);
    try {
      await api(`/api/admin/testimonials/${testimonialId}/highlights`, { method: "PUT", json: { highlights: list } });
      setPending(null);
      setError(null);
      document.getSelection()?.removeAllRanges();
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const current = highlights.map((h) => ({ answerId: h.answerId, start: h.start, end: h.end }));
  const shown = blocks.filter((b) => b.text);

  return (
    <section className="stack ib-section" ref={root} aria-labelledby="ib-answers-title" data-testid="highlight-editor">
      <h3 id="ib-answers-title" className="ib-section-title">
        Answers
      </h3>
      {shown.length === 0 && <p className="muted small">No written answer.</p>}
      {shown.map((b) => (
        <div key={b.answerId ?? "main"} className="ib-block" data-question={b.title}>
          <p className="muted xsmall ib-block-title">{b.title}</p>
          <p className="ib-block-text" data-hl-block={b.answerId ?? "main"} data-testid="highlight-source">
            <Marked text={b.text} marks={highlights.filter((h) => h.answerId === b.answerId)} />
          </p>
        </div>
      ))}
      {shown.length > 0 && (
        <div className="row ib-hl-actions">
          <button type="button" className="secondary small" disabled={!pending || saving} onClick={() => pending && void save([...current, pending])} data-testid="highlight-button">
            <Icon name="pen" />
            Highlight selection
          </button>
          <span className="muted xsmall" aria-live="polite">
            {pending ? `Selected: “${pending.phrase.length > 60 ? `${pending.phrase.slice(0, 60)}…` : pending.phrase}”` : "Select words above to highlight them."}
          </span>
        </div>
      )}
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
      {highlights.length > 0 && (
        <ul className="ib-hl-list" data-testid="highlight-list">
          {highlights.map((h) => (
            <li key={h.id} className="row">
              <mark>{h.phrase}</mark>
              <button
                type="button"
                className="ghost small"
                aria-label={`Remove highlight “${h.phrase}”`}
                disabled={saving}
                onClick={() => void save(current.filter((c) => !(c.answerId === h.answerId && c.start === h.start && c.end === h.end)))}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
