"use client";

import { useEffect, useId, useState } from "react";
import { contrastRatio, formatRatio, normalizeHex } from "./color";
import "@/app/admin/admin-kit.css";

/**
 * A labelled colour picker with a hex text box; both edit the same value,
 * which is always "#rrggbb" (or "" for "use the default" when `allowEmpty`).
 * A half-typed hex waits until it's valid and only shows an error on blur.
 * With `contrastWith` it warns when text in one colour on the other would be
 * hard to read (below 4.5:1, WCAG AA). An empty value is checked as its
 * `placeholder`, the default it falls back to, so a background changed
 * elsewhere still warns about the default text on it. The warning never
 * blocks saving.
 */
export type ColorFieldProps = {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  name?: string;
  allowEmpty?: boolean;
  hint?: string;
  /** The colour shown in the picker while the value is empty (the default it falls back to). */
  placeholder?: string;
  /** The colour this one sits on or under, for the contrast warning (as it will show: pass the default when that one is empty). */
  contrastWith?: string;
  /** Large text and icons need only 3:1. */
  minContrast?: number;
  disabled?: boolean;
  testId?: string;
};

export function ColorField({
  label,
  value,
  onChange,
  name,
  allowEmpty,
  hint,
  placeholder,
  contrastWith,
  minContrast = 4.5,
  disabled,
  testId,
}: ColorFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);

  // Follow changes made elsewhere (the picker, a reset), unless the draft already means the same colour.
  useEffect(() => {
    setDraft((d) => (normalizeHex(d) === normalizeHex(value) && value !== "" ? d : value));
    setInvalid(false);
  }, [value]);

  const hex = normalizeHex(value);
  const swatch = hex ?? normalizeHex(placeholder ?? "") ?? "#000000";
  const shown = hex ?? normalizeHex(placeholder ?? "");
  const ratio = shown && contrastWith ? contrastRatio(shown, contrastWith) : null;
  const low = ratio != null && ratio < minContrast ? ratio : null;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = invalid ? `${id}-error` : undefined;
  const warnId = low != null ? `${id}-warn` : undefined;
  const describedBy = [hintId, errorId, warnId].filter(Boolean).join(" ") || undefined;

  function onText(next: string) {
    setDraft(next);
    if (next.trim() === "") {
      if (allowEmpty) onChange("");
      return;
    }
    const h = normalizeHex(next);
    if (h) {
      setInvalid(false);
      if (h !== value) onChange(h);
    }
  }

  function onBlur() {
    if (draft.trim() === "") {
      if (!allowEmpty) {
        setDraft(value);
        setInvalid(false);
      }
      return;
    }
    const h = normalizeHex(draft);
    if (h) setDraft(h);
    setInvalid(!h);
  }

  return (
    <div className="ak-color" data-testid={testId}>
      <label htmlFor={`${id}-hex`}>{label}</label>
      {hint && (
        <p id={hintId} className="hint ak-hint">
          {hint}
        </p>
      )}
      <div className="ak-color-row">
        <input
          type="color"
          value={swatch}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          aria-label={`${label}, colour picker`}
          disabled={disabled}
          data-empty={hex ? undefined : true}
        />
        <input
          id={`${id}-hex`}
          type="text"
          name={name}
          value={draft}
          placeholder={allowEmpty ? (placeholder ? `Default (${placeholder})` : "Default") : "#000000"}
          onChange={(e) => onText(e.target.value)}
          onBlur={onBlur}
          maxLength={7}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
        />
        {allowEmpty && value !== "" && (
          <button type="button" className="ghost small" onClick={() => onChange("")} disabled={disabled}>
            Use default
          </button>
        )}
      </div>
      {invalid && (
        <p id={errorId} className="ak-field-error" role="alert">
          Enter a hex colour such as #3d63dd.
        </p>
      )}
      {low != null && (
        <p id={warnId} className="ak-field-warn">
          Low contrast ({formatRatio(low)}). Text may be hard to read; aim for at least {minContrast}:1.
        </p>
      )}
    </div>
  );
}
