"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { focusables, isRowKey, nextIndex, ownsArrowKeys } from "./keys";
import "@/app/admin/admin-kit.css";

/**
 * A row of controls above a list (search, filters, sort, view), with
 * role="toolbar". Every control keeps its Tab stop; the left and right
 * arrows, Home and End also move between them, except inside text boxes,
 * selects and radios, which keep their arrow keys. It wraps onto more lines
 * on phones.
 */
export type ToolbarProps = {
  label: string;
  children: ReactNode;
  testId?: string;
  className?: string;
};

export function Toolbar({ label, children, testId, className }: ToolbarProps) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !isRowKey(e.key)) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") return;
    const target = e.target as HTMLElement;
    if (ownsArrowKeys(target as HTMLInputElement)) return;
    const items = focusables(e.currentTarget);
    const at = items.indexOf(target);
    if (at < 0) return;
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const next = nextIndex(at, e.key, items.length, { rtl });
    if (next !== at && items[next]) {
      e.preventDefault();
      items[next].focus();
    }
  }

  return (
    <div
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      className={className ? `ak-toolbar ${className}` : "ak-toolbar"}
      data-testid={testId}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
