"use client";

import { Checkbox } from "@/components/admin";
import { TestimonialRow } from "../Dashboard";
import type { CardCallbacks } from "./Inbox";
import type { InboxRow } from "./types";

/**
 * The card view (the default): each testimonial with its media, answers,
 * consent record and the classic controls, plus a select box, Hide, Details
 * and the trash.
 */
export function CardView({ items, selection, ...cb }: { items: InboxRow[] } & CardCallbacks) {
  return (
    <div className="stack ib-cards" data-testid="inbox-cards">
      {items.length > 1 && (
        <div className="ib-select-all">
          <Checkbox
            label="Select all on this page"
            checked={selection.state === "all"}
            indeterminate={selection.state === "some"}
            onChange={() => selection.toggleAll()}
            testId="select-page"
          />
        </div>
      )}
      {items.map((t) => (
        <TestimonialRow
          key={t.id}
          t={t}
          transcription={cb.transcription}
          onUpdate={(patch) => cb.onUpdate(t.id, patch)}
          onDelete={() => cb.onTrash(t.id)}
          onReprocess={() => cb.onReprocess(t.id)}
          onTranscribe={() => cb.onTranscribe(t.id)}
          inbox={{
            onHide: () => cb.onHide(t.id),
            onRestore: () => cb.onRestore(t.id),
            onDeleteForever: () => cb.onDeleteForever(t.id),
            onOpen: () => cb.onOpen(t.id),
          }}
          select={
            <span className="ib-select">
              {/* aria-label, not hidden text: a hidden "Select Ada" would also match a search for "Ada" on the page. */}
              <input
                type="checkbox"
                aria-label={`Select ${t.authorName}`}
                checked={selection.has(t.id)}
                onChange={(e) => selection.toggle(t.id, { range: (e.nativeEvent as MouseEvent).shiftKey })}
                data-testid="select-row"
              />
            </span>
          }
        />
      ))}
    </div>
  );
}
