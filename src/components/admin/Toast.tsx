"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import "@/app/admin/admin-kit.css";

/**
 * A short confirmation at the bottom of the screen ("Moved to trash"), with
 * an optional action such as Undo. It goes after `duration` ms, but waits
 * while the pointer or focus is on it (WCAG 2.2.1), and Escape dismisses it.
 * Keep it mounted with `message={null}` between toasts: the live region has
 * to exist before the text appears to be announced. Inside an open Modal or
 * Drawer, render it inside that dialog so it shows above the shade.
 */
export type ToastProps = {
  message: string | null;
  onDismiss: () => void;
  action?: { label: string; onClick: () => void };
  /** Milliseconds; 0 keeps it until dismissed. Defaults to 5 s, or 10 s with an action. */
  duration?: number;
  tone?: "default" | "error";
  testId?: string;
};

export function Toast({ message, onDismiss, action, duration, tone = "default", testId }: ToastProps) {
  const [held, setHeld] = useState(false);
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });
  const ms = duration ?? (action ? 10_000 : 5_000);

  // A new message starts its own clock, even if the last one went while held.
  useEffect(() => setHeld(false), [message]);
  useEffect(() => {
    if (!message || held || ms <= 0) return;
    const t = setTimeout(() => dismiss.current(), ms);
    return () => clearTimeout(t);
  }, [message, held, ms]);

  return (
    <div className="ak-toast-region" role="status" aria-live="polite" data-testid={testId}>
      {message && (
        <div
          className="ak-toast"
          data-tone={tone}
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setHeld(false)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            dismiss.current();
          }}
        >
          <p className="ak-toast-text">{message}</p>
          {action && (
            <button
              type="button"
              className="ghost small"
              onClick={() => {
                action.onClick();
                dismiss.current();
              }}
            >
              {action.label}
            </button>
          )}
          <button type="button" className="ghost ak-icon-button" aria-label="Dismiss" onClick={() => dismiss.current()}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </div>
  );
}
