"use client";

import { useEffect, useRef, type ChangeEvent, type ReactNode } from "react";
import "@/app/admin/admin-kit.css";

/**
 * A labelled checkbox that can also show "some selected" (`indeterminate`,
 * announced as "mixed"), for a list's select-all box. onChange passes the
 * event too, so a list can read shiftKey for range selection.
 */
export type CheckboxProps = {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean, e: ChangeEvent<HTMLInputElement>) => void;
  indeterminate?: boolean;
  /** Keeps the label for screen readers only (a table row's select box). */
  hideLabel?: boolean;
  disabled?: boolean;
  name?: string;
  value?: string;
  testId?: string;
};

export function Checkbox({ label, checked, onChange, indeterminate, hideLabel, disabled, name, value, testId }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  // `indeterminate` is a DOM property only; there's no attribute for it.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate) && !checked;
  }, [indeterminate, checked]);
  return (
    <label className="check ak-check" data-testid={testId}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked, e)}
        disabled={disabled}
        name={name}
        value={value}
      />
      <span className={hideLabel ? "visually-hidden" : undefined}>{label}</span>
    </label>
  );
}
