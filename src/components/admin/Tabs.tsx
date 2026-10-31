"use client";

import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { isRowKey, nextIndex } from "./keys";
import "@/app/admin/admin-kit.css";

/**
 * In-page tabs (the builders' Content / Design / Settings / Share), following
 * the ARIA tabs pattern: one Tab stop for the row, the arrows, Home and End
 * move between tabs and select as they go, and the panel follows. For links
 * between pages use a <nav> instead (ProjectTabs).
 */
export type TabItem = { id: string; label: string; count?: number; disabled?: boolean };

export type TabsProps = {
  label: string;
  tabs: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** The selected tab's panel. Leave it out to render only the tab row. */
  children?: ReactNode;
  testId?: string;
};

export function Tabs({ label, tabs, value, onChange, children, testId }: TabsProps) {
  const base = useId();
  const list = useRef<HTMLDivElement>(null);
  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = `${base}-panel`;
  // A stale value still leaves one tab reachable by Tab.
  const selected = tabs.some((t) => t.id === value && !t.disabled) ? value : tabs.find((t) => !t.disabled)?.id;

  // One underline that slides to the selected tab (admin-kit.css draws it from these two values).
  useLayoutEffect(() => {
    const row = list.current;
    if (!row) return;
    const place = () => {
      const tab = row.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!tab) return row.removeAttribute("data-indicator");
      row.style.setProperty("--ak-ind-x", `${tab.offsetLeft}px`);
      row.style.setProperty("--ak-ind-w", `${tab.offsetWidth}px`);
      row.setAttribute("data-indicator", "");
    };
    place();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    ro?.observe(row);
    return () => ro?.disconnect();
  }, [selected, tabs]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey || !isRowKey(e.key) || e.key === "ArrowUp" || e.key === "ArrowDown") return;
    const at = tabs.findIndex((t) => t.id === selected);
    const rtl = list.current ? getComputedStyle(list.current).direction === "rtl" : false;
    const next = nextIndex(at, e.key, tabs.length, { disabled: (i) => Boolean(tabs[i].disabled), rtl });
    if (next < 0 || next === at) return;
    e.preventDefault();
    onChange(tabs[next].id);
    document.getElementById(tabId(tabs[next].id))?.focus();
  }

  return (
    <div className="ak-tabs" data-testid={testId}>
      <div ref={list} role="tablist" aria-label={label} className="ak-tablist" onKeyDown={onKeyDown}>
        {tabs.map((t) => {
          const on = t.id === selected;
          return (
            <button
              key={t.id}
              id={tabId(t.id)}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={on && children !== undefined ? panelId : undefined}
              tabIndex={on ? 0 : -1}
              disabled={t.disabled}
              onClick={() => !on && onChange(t.id)}
            >
              {t.label}
              {t.count != null && <span className="count">{t.count}</span>}
            </button>
          );
        })}
      </div>
      {children !== undefined && selected && (
        <div id={panelId} role="tabpanel" aria-labelledby={tabId(selected)} tabIndex={0} className="ak-tabpanel">
          {children}
        </div>
      )}
    </div>
  );
}
