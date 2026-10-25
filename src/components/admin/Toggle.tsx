"use client";

import { useId, type ReactNode } from "react";
import "@/app/admin/admin-kit.css";

/**
 * An on/off switch for a setting that applies at once (or on Save): a native
 * checkbox with role="switch", so it's announced as "on" or "off" and Space
 * flips it. The thumb's position shows the state, not only its colour.
 */
export type ToggleProps = {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
  name?: string;
  /** Keeps the label for screen readers only (a row whose heading already says it). */
  hideLabel?: boolean;
  testId?: string;
};

export function Toggle({ label, checked, onChange, hint, disabled, name, hideLabel, testId }: ToggleProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="ak-toggle" data-testid={testId}>
      <label className="ak-toggle-label">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          name={name}
          aria-describedby={hintId}
        />
        <span className="ak-toggle-track" aria-hidden>
          <span className="ak-toggle-thumb" />
        </span>
        <span className={hideLabel ? "visually-hidden" : "ak-toggle-text"}>{label}</span>
      </label>
      {hint && (
        <p id={hintId} className="hint ak-hint">
          {hint}
        </p>
      )}
    </div>
  );
}
