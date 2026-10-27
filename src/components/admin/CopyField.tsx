"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { copyText } from "./clipboard";
import "@/app/admin/admin-kit.css";

/**
 * A read-only value (link, snippet) with a Copy button that confirms in an
 * aria-live status. Where copying isn't allowed, it selects the text and says
 * how to copy it by hand. Focusing the value selects all of it.
 */
export type CopyFieldProps = {
  label: string;
  value: string;
  multiline?: boolean;
  testId?: string;
  hint?: ReactNode;
  /** The button's text, e.g. "Copy link". */
  copyLabel?: string;
  /** Rows for a multiline value. */
  rows?: number;
};

type State = "idle" | "copied" | "failed";

export function CopyField({ label, value, multiline, testId, hint, copyLabel = "Copy", rows = 4 }: CopyFieldProps) {
  const id = useId();
  const [state, setState] = useState<State>("idle");
  const box = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);
    const ok = await copyText(value, root.current);
    setState(ok ? "copied" : "failed");
    if (ok) timer.current = setTimeout(() => setState("idle"), 2000);
    else box.current?.select();
  }

  const hintId = hint ? `${id}-hint` : undefined;
  const statusId = `${id}-status`;
  const shared = {
    id: `${id}-value`,
    ref: box,
    value,
    readOnly: true,
    spellCheck: false,
    "aria-describedby": hintId,
    onFocus: (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => e.currentTarget.select(),
  };

  return (
    <div className="ak-copy" ref={root} data-testid={testId} data-multiline={multiline || undefined}>
      <label htmlFor={`${id}-value`}>{label}</label>
      {hint && (
        <p id={hintId} className="hint ak-hint">
          {hint}
        </p>
      )}
      <div className="ak-copy-row">
        {multiline ? <textarea rows={rows} {...shared} /> : <input type="text" {...shared} />}
        <button type="button" className="secondary small" onClick={copy} aria-describedby={statusId}>
          <Icon name={state === "copied" ? "check" : "copy"} />
          {copyLabel}
        </button>
      </div>
      <p id={statusId} className="ak-copy-status" role="status" data-state={state}>
        {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy. The text is selected: press Ctrl+C (⌘C on a Mac)." : ""}
      </p>
    </div>
  );
}
