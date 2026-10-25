"use client";

import type { ReactNode } from "react";
import { Toolbar } from "./Toolbar";
import "@/app/admin/admin-kit.css";

/**
 * The actions for the rows a person has selected (approve, hide, tag, trash…),
 * with how many are selected and a way to clear them. It sticks to the bottom
 * of the screen while the list scrolls. Keep it mounted: it hides itself at 0,
 * and its live status only announces changes if it's already on the page.
 */
export type BulkBarProps = {
  count: number;
  onClear: () => void;
  /** The action buttons. */
  children: ReactNode;
  /** How many match the current filter, for "Select all 312". */
  total?: number;
  onSelectAll?: () => void;
  /** What's being counted: ["testimonial", "testimonials"]. */
  noun?: readonly [string, string];
  testId?: string;
};

export function BulkBar({ count, onClear, children, total, onSelectAll, noun, testId }: BulkBarProps) {
  const what = noun ? ` ${count === 1 ? noun[0] : noun[1]}` : "";
  const summary = `${count}${what} selected`;
  return (
    <div className="ak-bulk" data-testid={testId}>
      <p className="visually-hidden" role="status">
        {count > 0 ? summary : ""}
      </p>
      {count > 0 && (
        <Toolbar label="Bulk actions" className="ak-bulk-bar">
          {/* The status above already says it to screen readers. */}
          <strong className="ak-bulk-count" aria-hidden>
            {summary}
          </strong>
          {onSelectAll && total != null && total > count && (
            <button type="button" className="ghost small" onClick={onSelectAll}>
              Select all {total}
            </button>
          )}
          <div className="ak-bulk-actions">{children}</div>
          <button type="button" className="ghost small" onClick={onClear}>
            Clear selection
          </button>
        </Toolbar>
      )}
    </div>
  );
}
