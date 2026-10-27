"use client";

import { useState } from "react";
import { ColorField, FontField, Segmented, Toggle } from "@/components/admin";
import { designWithBrand, FONT_CHOICES, formDesignStyle } from "@/lib/forms/design";
import { LABEL_KEYS, LOCALES, resolveLabels, type LabelKey } from "@/lib/forms/labels";
import type { FormDesign } from "@/lib/forms/schema";
import type { Brand } from "@/lib/validation";
import type { Draft } from "./Builder";

const FONTS = FONT_CHOICES.map((f) => ({ id: f.id, label: f.label, family: f.family, fallback: f.fallback }));

type ColorKey = keyof FormDesign & ("primary" | "background" | "text" | "button" | "buttonText" | "star");

/**
 * Each colour, the custom property that shows what it ends up as, and what
 * it's checked against: text needs 4.5:1, the primary colour, buttons and
 * stars (shapes, not text) 3:1. "Button" against the background is what
 * catches a white button on a white page.
 */
const COLORS: { key: ColorKey; label: string; shows: string; on?: { key: ColorKey; min: number } }[] = [
  { key: "primary", label: "Primary colour", shows: "--fr-primary", on: { key: "background", min: 3 } },
  { key: "background", label: "Background", shows: "--fr-bg" },
  { key: "text", label: "Text", shows: "--fr-text", on: { key: "background", min: 4.5 } },
  { key: "button", label: "Button", shows: "--fr-button", on: { key: "background", min: 3 } },
  { key: "buttonText", label: "Button text", shows: "--fr-button-text", on: { key: "button", min: 4.5 } },
  { key: "star", label: "Stars", shows: "--fr-star", on: { key: "background", min: 3 } },
];
const SHOWS = Object.fromEntries(COLORS.map((c) => [c.key, c.shows])) as Record<ColorKey, string>;

/** FORM-08 and FORM-09: logo, colours, fonts, shape and theme; the form's language and its wording. */
export function DesignEditor({
  draft,
  update,
  brand,
  accent,
  logoUrl,
  onLogo,
}: {
  draft: Draft;
  update: (fn: (d: Draft) => Draft) => void;
  brand: Brand;
  accent: string;
  logoUrl: string | null;
  onLogo: (file: File | null) => Promise<void>;
}) {
  const d = draft.design;
  const set = (patch: Partial<FormDesign>) => update((x) => ({ ...x, design: { ...x.design, ...patch } }));
  // The colours exactly as the public page will show them (FORM-08), defaults and brand kit included.
  const looks = formDesignStyle(designWithBrand(d, brand), accent);
  const isSet = (k: ColorKey) => Boolean(d[k] ?? brand.colors[k]);
  const [labelQuery, setLabelQuery] = useState("");
  const defaults = resolveLabels(draft.language);
  const overrides = draft.labels.overrides;
  const matching = LABEL_KEYS.filter((k) => {
    const q = labelQuery.trim().toLowerCase();
    return !q || k.toLowerCase().includes(q) || defaults[k].toLowerCase().includes(q) || (overrides[k] ?? "").toLowerCase().includes(q);
  });
  const edited = LABEL_KEYS.filter((k) => overrides[k]);
  const shown = [...new Set([...edited.filter((k) => matching.includes(k)), ...matching])].slice(0, 25);
  const setLabel = (k: LabelKey, v: string) =>
    update((x) => {
      const next = { ...x.labels.overrides };
      if (v) next[k] = v;
      else delete next[k];
      return { ...x, labels: { overrides: next } };
    });

  return (
    <div className="stack fb-editor" data-testid="design-editor">
      <h2 className="section-title">Logo</h2>
      <div className="row" style={{ gap: "var(--space-3)", flexWrap: "wrap" }}>
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Form logo" className="fb-logo" />
        )}
        <label className="button secondary small" style={{ flexDirection: "row" }}>
          {logoUrl ? "Replace logo" : "Upload logo"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            style={{ display: "none" }}
            data-testid="form-logo"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void onLogo(file);
            }}
          />
        </label>
        {logoUrl && (
          <button type="button" className="ghost small" onClick={() => void onLogo(null)}>
            Remove
          </button>
        )}
      </div>
      <p className="muted xsmall">Without one, the project&apos;s logo (or its initial) is shown.</p>
      <Toggle label="Show the logo" checked={d.showLogo} onChange={(showLogo) => set({ showLogo })} />

      <h2 className="section-title">Colours</h2>
      <p className="muted xsmall">Empty colours follow your brand kit, then the project colour.</p>
      <div className="fb-grid2">
        {COLORS.map(({ key, label, on }) => (
          <ColorField
            key={key}
            label={label}
            value={d[key] ?? ""}
            allowEmpty
            placeholder={looks[SHOWS[key]]}
            // Our default star colour is a soft gold; only warn once the stars or the background are your own.
            contrastWith={on && (key !== "star" || isSet("star") || isSet("background")) ? looks[SHOWS[on.key]] : undefined}
            minContrast={on?.min}
            onChange={(hex) => set({ [key]: hex || undefined })}
            testId={`color-${key}`}
          />
        ))}
      </div>

      <h2 className="section-title">Fonts</h2>
      <FontField label="Headings" value={d.headingFont ?? brand.fonts.heading ?? "schibsted"} choices={FONTS} onChange={(headingFont) => set({ headingFont })} testId="font-heading" />
      <FontField label="Body text" value={d.bodyFont ?? brand.fonts.body ?? "schibsted"} choices={FONTS} onChange={(bodyFont) => set({ bodyFont })} testId="font-body" />

      <h2 className="section-title">Layout</h2>
      <Segmented
        label="Width"
        value={d.width}
        onChange={(width) => set({ width })}
        options={[
          { value: "wide", label: "Wide" },
          { value: "compact", label: "Compact" },
        ]}
      />
      <Segmented
        label="Buttons"
        value={d.buttonStyle}
        onChange={(buttonStyle) => set({ buttonStyle })}
        options={[
          { value: "solid", label: "Solid" },
          { value: "soft", label: "Soft" },
        ]}
      />
      <Segmented
        label="Theme"
        value={d.theme}
        onChange={(theme) => set({ theme })}
        testId="theme"
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />
      <label>
        Corner radius: {d.radius} px
        <input type="range" min={0} max={24} value={d.radius} onChange={(e) => set({ radius: Number(e.target.value) })} />
      </label>

      <h2 className="section-title">Language and wording</h2>
      <label>
        Language
        <select value={draft.language} onChange={(e) => update((x) => ({ ...x, language: e.target.value }))} data-testid="form-language">
          {LOCALES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted xsmall">Every default label switches to the language. Translations other than English need a native speaker&apos;s review.</p>
      <label>
        Find a label to change
        <input type="search" value={labelQuery} onChange={(e) => setLabelQuery(e.target.value)} placeholder="Continue, Send, Your name…" />
      </label>
      <div className="fb-labels" data-testid="label-overrides">
        {shown.map((k) => (
          <label key={k}>
            <span className="xsmall muted">{k}</span>
            <input type="text" value={overrides[k] ?? ""} placeholder={defaults[k]} maxLength={500} onChange={(e) => setLabel(k, e.target.value)} data-label={k} />
          </label>
        ))}
        {matching.length > shown.length && <p className="muted xsmall">Narrow the search to see more of the {matching.length} matching labels.</p>}
      </div>
    </div>
  );
}
