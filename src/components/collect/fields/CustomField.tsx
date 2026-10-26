"use client";

import type { Labels } from "@/lib/forms/labels";
import type { CustomField as Field } from "@/lib/forms/schema";

type Props = {
  field: Field;
  value: string | boolean | undefined;
  onChange: (v: string | boolean) => void;
  error?: string;
  labels: Labels;
};

/** One owner-defined field (FORM-06): short or long text, dropdown, checkbox, NPS 0–10, URL or number. */
export function CustomField({ field, value, onChange, error, labels }: Props) {
  const id = `fr-c-${field.key}`;
  const errorId = error ? `${id}-error` : undefined;
  const label = (
    <span>
      {field.label} {!field.required && <span className="fr-optional">{labels.optional}</span>}
    </span>
  );
  const err = error && (
    <span className="fr-error" role="alert" id={errorId}>
      {error}
    </span>
  );
  const text = typeof value === "string" ? value : "";
  const common = { "aria-invalid": Boolean(error), "aria-describedby": errorId, required: field.required, placeholder: field.placeholder };

  switch (field.type) {
    case "checkbox":
      return (
        <div className="stack" style={{ gap: 4 }}>
          <label className="check">
            <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} aria-invalid={Boolean(error)} />
            {label}
          </label>
          {err}
        </div>
      );
    case "nps":
      return (
        <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }} aria-describedby={errorId} data-testid={`field-${field.key}`}>
          <legend style={{ padding: 0, marginBottom: 6 }}>{label}</legend>
          <div className="fr-nps">
            {Array.from({ length: 11 }, (_, n) => (
              <button key={n} type="button" aria-pressed={text === String(n)} onClick={() => onChange(text === String(n) ? "" : String(n))}>
                {n}
              </button>
            ))}
          </div>
          <div className="fr-nps-ends" aria-hidden>
            <span>{labels.npsLow}</span>
            <span>{labels.npsHigh}</span>
          </div>
          {err}
        </fieldset>
      );
    case "dropdown":
      return (
        <label>
          {label}
          <select value={text} onChange={(e) => onChange(e.target.value)} {...common}>
            <option value="">{field.placeholder || labels.choose}</option>
            {(field.options ?? []).map((o) => (
              <option key={o.label} value={o.label}>
                {o.label}
              </option>
            ))}
          </select>
          {err}
        </label>
      );
    case "long":
      return (
        <label>
          {label}
          <textarea value={text} maxLength={2000} onChange={(e) => onChange(e.target.value)} {...common} />
          {err}
        </label>
      );
    default:
      return (
        <label>
          {label}
          <input
            type={field.type === "url" ? "url" : field.type === "number" ? "number" : "text"}
            inputMode={field.type === "number" ? "decimal" : undefined}
            value={text}
            maxLength={field.type === "url" ? 2000 : 200}
            onChange={(e) => onChange(e.target.value)}
            {...common}
          />
          {err}
        </label>
      );
  }
}
