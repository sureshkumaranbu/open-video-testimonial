"use client";

import { useState } from "react";
import { BulkBar, Modal } from "@/components/admin";
import { Icon } from "@/components/Icon";
import type { InboxTab } from "@/lib/inbox-query";

/**
 * The actions for the selected rows (INBOX-06), one request each. In the
 * trash: restore or delete for good. Shown only while something is selected,
 * so no other button on the page shares the status tabs' names.
 */
export function InboxBulkBar({
  count,
  tab,
  onClear,
  onAction,
  onExport,
  tags,
}: {
  count: number;
  tab: InboxTab;
  onClear: () => void;
  onAction: (action: string, tags?: string[]) => void;
  onExport: (format: "csv" | "json") => void;
  tags: string[];
}) {
  const [tagging, setTagging] = useState(false);
  const [text, setText] = useState("");
  const names = text
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const run = (action: "tag" | "untag") => {
    onAction(action, names);
    setTagging(false);
    setText("");
  };
  return (
    <>
      <BulkBar count={count} onClear={onClear} noun={["testimonial", "testimonials"]} testId="bulk-bar">
        {tab === "trash" ? (
          <>
            <button type="button" className="secondary small" onClick={() => onAction("restore")}>
              <Icon name="restore" />
              Restore
            </button>
            <button type="button" className="danger small" onClick={() => onAction("delete")}>
              <Icon name="trash" />
              Delete forever
            </button>
          </>
        ) : (
          <>
            <button type="button" className="approve small" onClick={() => onAction("approve")}>
              <Icon name="check" />
              Approve
            </button>
            <button type="button" className="secondary small" onClick={() => onAction("hide")}>
              <Icon name="lock" />
              Hide
            </button>
            <button type="button" className="secondary small" onClick={() => onAction("reject")}>
              <Icon name="close" />
              Reject
            </button>
            <button type="button" className="secondary small" onClick={() => setTagging(true)}>
              Tags…
            </button>
            <button type="button" className="secondary small" onClick={() => onExport("csv")}>
              <Icon name="download" />
              Export CSV
            </button>
            <button type="button" className="danger small" onClick={() => onAction("trash")}>
              <Icon name="trash" />
              Move to trash
            </button>
          </>
        )}
      </BulkBar>
      <Modal
        open={tagging}
        onClose={() => setTagging(false)}
        title={`Tags for ${count} ${count === 1 ? "testimonial" : "testimonials"}`}
        size="sm"
        testId="bulk-tags"
        footer={
          <>
            <button type="button" className="ghost" onClick={() => setTagging(false)}>
              Cancel
            </button>
            <button type="button" className="secondary" disabled={!names.length} onClick={() => run("untag")}>
              Remove tags
            </button>
            <button type="button" disabled={!names.length} onClick={() => run("tag")}>
              Add tags
            </button>
          </>
        }
      >
        <label>
          Tags (comma separated)
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} list="bulk-tag-names" placeholder="pricing, homepage" data-autofocus />
        </label>
        <datalist id="bulk-tag-names">
          {tags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <p className="muted xsmall">Other tags on each testimonial stay as they are.</p>
      </Modal>
    </>
  );
}
