"use client";

import { useId } from "react";
import { fontFamilyOf, type FontChoice } from "./fonts";
import "@/app/admin/admin-kit.css";

/**
 * A labelled font picker: a radio group (so the arrow keys move the choice)
 * where each choice previews in its own font. The fonts themselves are
 * loaded by whoever lists them (self-hosted, see FONT_CHOICES in WP2.2).
 */
export type FontFieldProps = {
  label: string;
  value: string;
  onChange: (id: string) => void;
  choices: readonly FontChoice[];
  name?: string;
  hint?: string;
  /** What each choice shows in its own font. */
  sample?: string;
  disabled?: boolean;
  testId?: string;
};

export function FontField({ label, value, onChange, choices, name, hint, sample = "Aa", disabled, testId }: FontFieldProps) {
  const id = useId();
  const group = name ?? `${id}-font`;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <fieldset className="ak-font" aria-describedby={hintId} disabled={disabled} data-testid={testId}>
      <legend>{label}</legend>
      {hint && (
        <p id={hintId} className="hint ak-hint">
          {hint}
        </p>
      )}
      <div className="ak-font-grid">
        {choices.map((c) => (
          <label key={c.id} className="ak-font-choice" data-checked={value === c.id || undefined}>
            <input type="radio" name={group} value={c.id} checked={value === c.id} onChange={() => onChange(c.id)} />
            <span className="ak-font-sample" style={{ fontFamily: fontFamilyOf(c) }} aria-hidden>
              {sample}
            </span>
            <span className="ak-font-name">{c.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
