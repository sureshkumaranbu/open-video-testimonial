"use client";

import { ColorField, Segmented, Toggle, worstPair } from "@/components/admin";
import type { WidgetLayout } from "@/db/schema";
import {
  FLAGGED_LAYOUTS,
  LAYOUT_LABELS,
  LAYOUTS,
  PLACEMENT_LABELS,
  PLACEMENTS,
  placementHint,
  TOAST_POSITIONS,
  WIDGET_FONTS,
  type WidgetConfig,
  type WidgetDesign,
  type WidgetLabels,
  type WidgetOptions,
} from "@/lib/widget-config";
import { MAX_CUSTOM_CSS, sanitizeCss } from "@/lib/custom-css";
import { accentStyle } from "@/lib/theme";
import { LayoutThumb } from "../LayoutThumb";
import { setSection, type Draft, type Update } from "./Studio";

type PanelProps = { draft: Draft; update: Update };

/** A number input that keeps the last valid value while the field is being typed into. */
function NumberField({ label, value, min, max, onChange, hint, testId }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void; hint?: string; testId?: string }) {
  return (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        data-testid={testId}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isInteger(n) && n >= min && n <= max) onChange(n);
        }}
      />
      {hint && <span className="ws-hint">{hint}</span>}
    </label>
  );
}

// ------------------------------------------------------------------ layout

export function LayoutPanel({ draft, update, commerce = false }: PanelProps & { commerce?: boolean }) {
  const hint = placementHint(draft.placement);
  // The sales popup (INT-07) is offered with the commerce flag, or while it's the widget's layout.
  const layouts = LAYOUTS.filter((l) => !FLAGGED_LAYOUTS[l] || commerce || draft.config.layout === l);
  return (
    <div className="stack">
      <div className="ws-layouts" role="radiogroup" aria-label="Layout">
        {layouts.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            className="ws-layout"
            aria-checked={draft.config.layout === l}
            data-testid={`layout-${l}`}
            onClick={() => update((d) => ({ ...d, config: { ...d.config, layout: l as WidgetLayout } }))}
          >
            <LayoutThumb layout={l} />
            <span>
              <b>{LAYOUT_LABELS[l].name}</b>
              <small>{LAYOUT_LABELS[l].blurb}</small>
              {hint?.layouts.includes(l) && <span className="ws-rec">Recommended here</span>}
            </span>
          </button>
        ))}
      </div>
      <p className="ws-hint">You can switch layouts at any time; your picks, design and labels stay.</p>
    </div>
  );
}

// ------------------------------------------------------------------ design

type ColourKey = "accent" | "text" | "titleColor" | "dateColor" | "star" | "card" | "border" | "background";

/** The light and dark defaults (widget-html.ts and widget.js use the same). */
const COLOURS: { key: ColourKey; label: string; light: string; dark: string }[] = [
  { key: "accent", label: "Accent (initials, quote marks, buttons)", light: "", dark: "" },
  { key: "text", label: "Text", light: "#161b2e", dark: "#eef0f6" },
  { key: "titleColor", label: "Names", light: "#161b2e", dark: "#eef0f6" },
  { key: "dateColor", label: "Dates and job titles", light: "#545c70", dark: "#a4abbd" },
  { key: "star", label: "Stars", light: "#f2a93b", dark: "#f2a93b" },
  { key: "card", label: "Cards", light: "#ffffff", dark: "#171b2b" },
  { key: "border", label: "Card borders", light: "#e3e6ec", dark: "#262c40" },
  { key: "background", label: "Background (empty is transparent)", light: "#ffffff", dark: "#ffffff" },
];
const DEFAULTS = Object.fromEntries(COLOURS.map((c) => [c.key, c])) as Record<ColourKey, (typeof COLOURS)[number]>;

/**
 * What each colour is checked against (DISP-03): text, names and dates sit
 * on the card (4.5:1), stars need 3:1, and the accent against the text the
 * widget puts on it. With "Match the visitor" both themes are checked and
 * the worse pair is shown, so its default is the one in the placeholder.
 */
function contrastTargets(d: WidgetDesign, accent: string) {
  const modes: ("light" | "dark")[] = d.theme === "auto" ? ["light", "dark"] : [d.theme === "dark" ? "dark" : "light"];
  const value = (k: ColourKey) => String(d[k] ?? "");
  const fg = (k: ColourKey, m: "light" | "dark"): string => value(k) || (k === "titleColor" ? fg("text", m) : DEFAULTS[k][m]);
  const onCard = (k: ColourKey, min: number) => {
    const [shows, on] = worstPair(modes.map((m): [string, string] => [fg(k, m), value("card") || DEFAULTS.card[m]])) ?? [fg(k, modes[0]), undefined];
    return { shows, on, min };
  };
  const accentNow = value("accent") || accent;
  const star = onCard("star", 3);
  return {
    accent: { shows: accentNow, on: accentStyle(accentNow)["--on-accent"], min: 4.5 },
    text: onCard("text", 4.5),
    titleColor: onCard("titleColor", 4.5),
    dateColor: onCard("dateColor", 4.5),
    // The default gold is ours to get right; warn once the stars or cards are your own.
    star: { ...star, on: value("star") || value("card") ? star.on : undefined },
  } as Partial<Record<ColourKey, { shows: string; on: string | undefined; min: number }>>;
}

const SHOW: { key: keyof WidgetDesign; label: string }[] = [
  { key: "showRating", label: "Star rating" },
  { key: "showSource", label: "Source icon (links to the original review)" },
  { key: "showAvatar", label: "Photo or initials" },
  { key: "showTitle", label: "Job title and company" },
  { key: "showHeadline", label: "Headline" },
  { key: "showImages", label: "Images" },
  { key: "showVideo", label: "Video" },
  { key: "showHighlights", label: "Highlighted phrases" },
  { key: "showVerified", label: "“Verified” mark on form submissions" },
  { key: "showVerifiedPurchase", label: "“Verified purchase” mark on testimonials from buyers (Stripe)" },
  { key: "firstNameOnly", label: "First name only" },
];

export function DesignPanel({ draft, update, accent, translations = false, commerce = false }: PanelProps & { accent: string; translations?: boolean; commerce?: boolean }) {
  const d = draft.config.design;
  const set = (patch: Partial<WidgetDesign>) => setSection(update, "design", patch);
  const targets = contrastTargets(d, accent);
  const mode = d.theme === "dark" ? "dark" : "light";
  return (
    <div className="stack">
      <Segmented
        label="Theme"
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
          { value: "auto", label: "Match the visitor" },
        ]}
        value={d.theme}
        onChange={(theme) => set({ theme })}
        testId="design-theme"
      />
      <label>
        Font
        <select value={d.font} onChange={(e) => set({ font: e.target.value as WidgetDesign["font"] })} data-testid="design-font">
          {WIDGET_FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="ws-fieldset">
        <legend>Colours</legend>
        {COLOURS.map((c) => (
          <ColorField
            key={c.key}
            label={c.label}
            value={String(d[c.key] ?? "")}
            allowEmpty
            placeholder={targets[c.key]?.shows ?? c[mode]}
            contrastWith={targets[c.key]?.on}
            minContrast={targets[c.key]?.min}
            onChange={(hex) => set({ [c.key]: hex } as Partial<WidgetDesign>)}
            testId={`widget-color-${c.key}`}
          />
        ))}
      </fieldset>
      <fieldset className="ws-fieldset">
        <legend>Shape and spacing</legend>
        <div className="ws-two">
          <NumberField label="Corner radius (px)" value={d.radius} min={0} max={32} onChange={(radius) => set({ radius })} />
          <NumberField label="Space between cards (px)" value={d.spacing} min={0} max={48} onChange={(spacing) => set({ spacing })} />
        </div>
        <NumberField label="Most width (px)" value={d.maxWidth} min={0} max={2400} onChange={(maxWidth) => set({ maxWidth })} hint="0 fills the space it's placed in." />
        <Toggle label="Card shadow" checked={d.shadow} onChange={(shadow) => set({ shadow })} />
      </fieldset>
      <fieldset className="ws-fieldset">
        <legend>Show</legend>
        {SHOW.filter((s) => s.key !== "showVerifiedPurchase" || commerce).map((s) => (
          <Toggle
            key={s.key}
            label={s.label}
            checked={Boolean(d[s.key])}
            onChange={(v) => set({ [s.key]: v } as Partial<WidgetDesign>)}
            testId={`design-${s.key}`}
          />
        ))}
        <Segmented
          label="Date"
          options={[
            { value: "hidden", label: "Hidden" },
            { value: "absolute", label: "Date" },
            { value: "relative", label: "Time ago" },
          ]}
          value={d.date}
          onChange={(date) => set({ date })}
        />
        {translations && (
          <Segmented
            label="Translations"
            options={[
              { value: "off", label: "Off" },
              { value: "visitor", label: "Visitor’s language" },
            ]}
            value={d.translations}
            onChange={(v) => set({ translations: v as WidgetDesign["translations"] })}
            testId="design-translations"
          />
        )}
        <NumberField
          label="“Read more” after (characters)"
          value={d.readMore}
          min={0}
          max={2000}
          onChange={(readMore) => set({ readMore })}
          hint="0 always shows the whole text."
        />
      </fieldset>
      <CustomCss draft={draft} update={update} />
    </div>
  );
}

/** Class names widget.js draws with, for people writing their own CSS. */
const CSS_HOOKS = ".c (a card), p (the words), .s (stars), .a (the person), .n (name), .m (title and date), .av (photo), .b (buttons), mark (highlights)";

/**
 * DISP-08: the owner's CSS, scoped to the widget's shadow root, so it can't
 * touch the rest of the page. What the server keeps is shown when cleaning
 * changed something (no @import, no outside url(), no "<").
 */
function CustomCss({ draft, update }: PanelProps) {
  const css = draft.config.css;
  const cleaned = sanitizeCss(css, { origin: typeof location === "undefined" ? "" : location.origin });
  const changed = css.trim() !== cleaned;
  return (
    <fieldset className="ws-fieldset" data-testid="custom-css">
      <legend>Custom CSS</legend>
      <label>
        CSS for this widget only
        <textarea
          rows={8}
          spellCheck={false}
          maxLength={MAX_CUSTOM_CSS}
          className="ws-css"
          value={css}
          placeholder={".x .c { border-width: 2px; }\n.x .n { text-transform: uppercase; }"}
          onChange={(e) => update((d) => ({ ...d, config: { ...d.config, css: e.target.value } }))}
          data-testid="custom-css-input"
        />
        <span className="ws-hint">
          {`${css.length.toLocaleString("en")} of ${MAX_CUSTOM_CSS.toLocaleString("en")} characters. It applies inside the widget only (its shadow root), and shows in the preview. Classes: ${CSS_HOOKS}; :host is the widget's box. Start selectors with .x (as in .x .n) so they win over the widget's own styles.`}
        </span>
      </label>
      {changed && (
        <div className="notice warn small" role="status" data-testid="custom-css-cleaned">
          <p style={{ margin: 0 }}>
            Some of this won&rsquo;t be used: widgets never load anything from other sites (@import, outside url(), image-set) and never take &ldquo;&lt;&rdquo;. What
            will apply:
          </p>
          <pre className="ws-css-out">{cleaned || "(nothing)"}</pre>
        </div>
      )}
    </fieldset>
  );
}

// ------------------------------------------------------------------ settings

/** INT-07: what a sales popup shows of each purchase. Anything off never leaves the server. */
function SalesOptions({ o, set, projectId }: { o: WidgetOptions; set: (patch: Partial<WidgetOptions>) => void; projectId: string }) {
  return (
    <div className="stack" data-testid="sales-options">
      <p className="ws-hint">
        Purchases come from this project&apos;s Stripe connection (<a href={`/admin/projects/${projectId}/commerce`}>Commerce</a>). Only the first name, a city
        or country, the product and the amount are ever kept, and only what you tick here is sent to visitors. The brand colour is the accent on the Design tab.
      </p>
      <Toggle label="First name" checked={o.salesName} onChange={(salesName) => set({ salesName })} testId="sales-name" />
      <Toggle label="City or country" checked={o.salesPlace} onChange={(salesPlace) => set({ salesPlace })} testId="sales-place" />
      <Toggle label="What they bought" checked={o.salesProduct} onChange={(salesProduct) => set({ salesProduct })} testId="sales-product" />
      <Toggle label="Amount paid" checked={o.salesAmount} onChange={(salesAmount) => set({ salesAmount })} testId="sales-amount" />
      <Toggle label="How long ago" checked={o.salesTime} onChange={(salesTime) => set({ salesTime })} testId="sales-time" />
      <Toggle
        label="Mix in approved testimonials"
        hint="Short snippets of the testimonials this widget picks (Testimonials tab), between the purchases."
        checked={o.salesMix}
        onChange={(salesMix) => set({ salesMix })}
        testId="sales-mix"
      />
      <NumberField label="Purchases from the last (days)" value={o.salesDays} min={1} max={365} onChange={(salesDays) => set({ salesDays })} />
    </div>
  );
}

export function SettingsPanel({ draft, update, forms, projectId }: PanelProps & { forms: { id: string; name: string }[]; projectId: string }) {
  const o = draft.config.options;
  const layout = draft.config.layout;
  const set = (patch: Partial<WidgetOptions>) => setSection(update, "options", patch);
  const hint = placementHint(draft.placement);
  const moving = layout === "carousel" || layout === "slider";
  return (
    <div className="stack">
      <label>
        Widget name
        <input type="text" value={draft.name} maxLength={120} onChange={(e) => update((d) => ({ ...d, name: e.target.value }))} />
      </label>
      <label>
        Where it goes
        <select value={draft.placement} onChange={(e) => update((d) => ({ ...d, placement: e.target.value }))} data-testid="settings-placement">
          <option value="">Not sure yet</option>
          {PLACEMENTS.map((p) => (
            <option key={p} value={p}>
              {PLACEMENT_LABELS[p]}
            </option>
          ))}
        </select>
        {hint && (
          <span className="ws-hint" data-testid="placement-hint">
            {hint.text}
          </span>
        )}
      </label>

      <fieldset className="ws-fieldset">
        <legend>{LAYOUT_LABELS[layout].name} options</legend>
        {layout === "grid" && <NumberField label="Most columns" value={o.columns} min={1} max={4} onChange={(columns) => set({ columns })} />}
        {layout === "slider" && <NumberField label="Cards side by side" value={o.perView} min={1} max={4} onChange={(perView) => set({ perView })} />}
        {moving && (
          <>
            <Toggle label="Arrows" checked={o.arrows} onChange={(arrows) => set({ arrows })} />
            <Toggle label="Dots" checked={o.dots} onChange={(dots) => set({ dots })} />
            <Toggle label="Move on by itself" hint="Never for visitors who ask for reduced motion." checked={o.autoplay} onChange={(autoplay) => set({ autoplay })} />
            {o.autoplay && <NumberField label="Seconds per slide" value={o.delay} min={2} max={30} onChange={(delay) => set({ delay })} />}
          </>
        )}
        {layout === "marquee" && (
          <>
            <NumberField label="Rows" value={o.rows} min={1} max={3} onChange={(rows) => set({ rows })} />
            <NumberField label="Speed (1 slow – 10 fast)" value={o.speed} min={1} max={10} onChange={(speed) => set({ speed })} />
            <Segmented
              label="Direction"
              options={[
                { value: "left", label: "To the left" },
                { value: "right", label: "To the right" },
              ]}
              value={o.direction}
              onChange={(direction) => set({ direction })}
            />
          </>
        )}
        {layout === "sales" && <SalesOptions o={o} set={set} projectId={projectId} />}
        {(layout === "toast" || layout === "sales") && (
          <>
            <label>
              Corner
              <select value={o.toastPosition} onChange={(e) => set({ toastPosition: e.target.value as WidgetOptions["toastPosition"] })}>
                {TOAST_POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {p.replace("-", " ")}
                  </option>
                ))}
              </select>
            </label>
            <div className="ws-two">
              <NumberField label="First one after (s)" value={o.toastDelay} min={0} max={120} onChange={(toastDelay) => set({ toastDelay })} />
              <NumberField label="Each stays (s)" value={o.toastDuration} min={3} max={60} onChange={(toastDuration) => set({ toastDuration })} />
            </div>
            <Toggle label="Hide on phones" checked={o.toastHideOnMobile} onChange={(toastHideOnMobile) => set({ toastHideOnMobile })} />
          </>
        )}
        <Toggle label="Load images and videos as they scroll into view" checked={o.lazy} onChange={(lazy) => set({ lazy })} />
      </fieldset>

      <fieldset className="ws-fieldset">
        <legend>Rating summary</legend>
        <Toggle
          label="Show the average and count above the testimonials"
          checked={draft.config.aggregate.show}
          onChange={(show) => setSection(update, "aggregate", { show })}
          testId="aggregate-show"
        />
        <Segmented
          label="Count"
          options={[
            { value: "filtered", label: "This widget’s testimonials" },
            { value: "all", label: "All approved" },
          ]}
          value={draft.config.aggregate.scope}
          onChange={(scope) => setSection(update, "aggregate", { scope })}
        />
      </fieldset>

      <fieldset className="ws-fieldset">
        <legend>“Leave a testimonial” button</legend>
        <label>
          Form it opens
          <select
            value={draft.connectedFormId ?? ""}
            onChange={(e) => update((d) => ({ ...d, connectedFormId: e.target.value || null }))}
            data-testid="cta-form"
          >
            <option value="">None</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <Toggle
          label="Show the button"
          checked={draft.config.cta.enabled}
          onChange={(enabled) => setSection(update, "cta", { enabled })}
          hint={draft.connectedFormId ? undefined : "Choose a form first."}
          disabled={!draft.connectedFormId}
          testId="cta-enabled"
        />
        <Segmented
          label="Opens"
          options={[
            { value: "link", label: "The form page" },
            { value: "popup", label: "A pop-up on the page" },
          ]}
          value={draft.config.cta.mode}
          onChange={(mode) => setSection(update, "cta", { mode })}
        />
      </fieldset>
    </div>
  );
}

// ------------------------------------------------------------------ labels

const LABELS: { key: keyof WidgetLabels; label: string; commerce?: boolean }[] = [
  { key: "readMore", label: "Read more" },
  { key: "readLess", label: "Read less" },
  { key: "reviews", label: "“reviews” after the count" },
  { key: "outOf", label: "“out of 5” after the average" },
  { key: "cta", label: "Button" },
  { key: "empty", label: "When there’s nothing to show" },
  { key: "verified", label: "Verified mark" },
  { key: "verifiedPurchase", label: "Verified purchase mark", commerce: true },
  { key: "salesLine", label: "Sales popup line ({name}, {place}, {product})", commerce: true },
  { key: "salesLineNoPlace", label: "Sales popup line without a place", commerce: true },
  { key: "salesSomeone", label: "Sales popup: when the name is hidden", commerce: true },
  { key: "salesNoProduct", label: "Sales popup: when the product is hidden", commerce: true },
  { key: "transcript", label: "Transcript" },
  { key: "previous", label: "Previous (arrow button)" },
  { key: "next", label: "Next (arrow button)" },
  { key: "pause", label: "Pause" },
  { key: "play", label: "Play" },
  { key: "dismiss", label: "Close" },
];

export function LabelsPanel({ draft, update, commerce = false }: PanelProps & { commerce?: boolean }) {
  const l = draft.config.labels;
  return (
    <div className="stack">
      <p className="ws-hint">The words visitors see. Write them in your site&apos;s language; an empty field goes back to English.</p>
      {LABELS.filter((x) => !x.commerce || commerce).map((x) => (
        <label key={x.key}>
          {x.label}
          <input
            type="text"
            maxLength={60}
            value={l[x.key]}
            data-testid={`label-${x.key}`}
            onChange={(e) => setSection(update, "labels", { [x.key]: e.target.value } as Partial<WidgetConfig["labels"]>)}
          />
        </label>
      ))}
    </div>
  );
}
