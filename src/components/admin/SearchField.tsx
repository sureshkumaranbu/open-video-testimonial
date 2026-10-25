"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import "@/app/admin/admin-kit.css";

/**
 * A search box for a list. It waits `debounceMs` after the last key before
 * calling onChange (Enter sends at once), and Escape or the clear button
 * empties it. The label is for screen readers only unless `showLabel`.
 */
export type SearchFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  showLabel?: boolean;
  testId?: string;
};

export function SearchField({ label, value, onChange, placeholder, debounceMs = 250, showLabel, testId }: SearchFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const sent = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });

  // A new value from outside (a "Clear filters" button, the URL) replaces the draft.
  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value;
      setDraft(value);
    }
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function send(next: string) {
    clearTimeout(timer.current);
    if (next === sent.current) return;
    sent.current = next;
    latest.current(next);
  }

  function edit(next: string) {
    setDraft(next);
    clearTimeout(timer.current);
    if (debounceMs <= 0) send(next);
    else timer.current = setTimeout(() => send(next), debounceMs);
  }

  return (
    <div className="ak-search" data-testid={testId}>
      <label htmlFor={`${id}-q`} className={showLabel ? undefined : "visually-hidden"}>
        {label}
      </label>
      <div className="ak-search-box">
        <Icon name="search" />
        <input
          ref={input}
          id={`${id}-q`}
          type="search"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => edit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send(draft);
            } else if (e.key === "Escape" && draft) {
              // Only swallow Escape when there's something to clear, so a drawer can still close.
              e.preventDefault();
              e.stopPropagation();
              setDraft("");
              send("");
            }
          }}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
        />
        {draft && (
          <button
            type="button"
            className="ghost ak-icon-button"
            aria-label="Clear search"
            onClick={() => {
              setDraft("");
              send("");
              input.current?.focus();
            }}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
    </div>
  );
}
