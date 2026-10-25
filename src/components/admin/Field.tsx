"use client";

import { cloneElement, isValidElement, useId, type AriaAttributes, type ReactElement, type ReactNode } from "react";
import "@/app/admin/admin-kit.css";

type ControlProps = Pick<AriaAttributes, "aria-describedby" | "aria-invalid"> & { id?: string };

/**
 * A label, one control, a hint and an error, tied together: the control gets
 * the label's id and `aria-describedby` for the hint and error, and
 * `aria-invalid` while there's an error. Show `error` after a blur or submit,
 * not on every key press (it's announced as it appears).
 */
export type FieldProps = {
  label: ReactNode;
  /** One input, select or textarea (or a component that passes these props on). */
  children: ReactElement<ControlProps>;
  hint?: ReactNode;
  error?: string | null;
  /** Adds "(optional)" after the label. */
  optional?: boolean;
  testId?: string;
};

export function Field({ label, children, hint, error, optional, testId }: FieldProps) {
  const auto = useId();
  const control = isValidElement(children) ? children : null;
  const id = control?.props.id ?? `${auto}-control`;
  const hintId = hint ? `${auto}-hint` : undefined;
  const errorId = error ? `${auto}-error` : undefined;
  const describedBy = [control?.props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="ak-field" data-invalid={error ? true : undefined} data-testid={testId}>
      <label htmlFor={id}>
        {label}
        {optional && <span className="hint">(optional)</span>}
      </label>
      {hint && (
        <p id={hintId} className="hint ak-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="ak-field-error" role="alert">
          {error}
        </p>
      )}
      {control &&
        cloneElement(control, {
          id,
          "aria-describedby": describedBy,
          "aria-invalid": error ? true : control.props["aria-invalid"],
        })}
    </div>
  );
}
