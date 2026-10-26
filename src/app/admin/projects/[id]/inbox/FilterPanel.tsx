"use client";

import { useEffect, useState } from "react";
import { Checkbox, FilterChips, Segmented } from "@/components/admin";
import { INBOX_METHODS, type InboxMethod, type InboxQuery } from "@/lib/inbox-query";
import type { InboxFacetsJson } from "./types";

const METHOD_LABEL: Record<InboxMethod, string> = {
  form: "Form",
  manual: "Added by hand",
  csv: "CSV import",
  platform: "Platform import",
  api: "API",
};
const TYPE_LABEL = { text: "Text only", video: "Video", image: "Image" } as const;
const SCOPE_LABEL = { website: "Website", social: "Social media", ads: "Ads", name: "Full name", face: "Face" } as const;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const stars = (r: number) => (r === 0 ? "No rating" : `${r}★`);

/** The filters in use, as removable chips. */
export function activeFilters(q: InboxQuery, facets: InboxFacetsJson | null): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  if (q.rating.length) out.push({ id: "rating", label: `Rating: ${[...q.rating].sort().map(stars).join(", ")}` });
  if (q.tags.length) out.push({ id: "tags", label: `Tags: ${q.tags.join(q.tagMode === "all" ? " and " : " or ")}` });
  if (q.formId) out.push({ id: "form", label: `Form: ${facets?.forms.find((f) => f.id === q.formId)?.name ?? "one form"}` });
  if (q.type) out.push({ id: "type", label: `Type: ${TYPE_LABEL[q.type]}` });
  if (q.platform.length) out.push({ id: "platform", label: `Source: ${q.platform.map(cap).join(", ")}` });
  if (q.method.length) out.push({ id: "method", label: `Added via: ${q.method.map((m) => METHOD_LABEL[m]).join(", ")}` });
  if (q.language) out.push({ id: "language", label: `Language: ${q.language}` });
  if (q.hasAvatar) out.push({ id: "hasAvatar", label: "Has a photo" });
  if (q.hasLogo) out.push({ id: "hasLogo", label: "Has a logo" });
  if (q.hasImages) out.push({ id: "hasImages", label: "Has images" });
  if (q.scope) out.push({ id: "scope", label: `Consent: ${SCOPE_LABEL[q.scope]}` });
  if (q.wordsMin != null || q.wordsMax != null) out.push({ id: "words", label: `Words: ${q.wordsMin ?? 0}–${q.wordsMax ?? "any"}` });
  if (q.from || q.to) out.push({ id: "dates", label: `Added: ${q.from ?? "any"} to ${q.to ?? "today"}` });
  return out;
}

/** The change that removes one filter, or every filter for "*" (the search and tab stay). */
export function clearFilter(id: string): Partial<InboxQuery> {
  const all = id === "*";
  const patch: Partial<InboxQuery> = {};
  if (all || id === "rating") patch.rating = [];
  if (all || id === "tags") Object.assign(patch, { tags: [], tagMode: "any" });
  if (all || id === "form") patch.formId = null;
  if (all || id === "type") patch.type = null;
  if (all || id === "platform") patch.platform = [];
  if (all || id === "method") patch.method = [];
  if (all || id === "language") patch.language = null;
  if (all || id === "hasAvatar") patch.hasAvatar = false;
  if (all || id === "hasLogo") patch.hasLogo = false;
  if (all || id === "hasImages") patch.hasImages = false;
  if (all || id === "scope") patch.scope = null;
  if (all || id === "words") Object.assign(patch, { wordsMin: null, wordsMax: null });
  if (all || id === "dates") Object.assign(patch, { from: null, to: null });
  return patch;
}

/** A number box that applies on blur or Enter, so typing "120" doesn't search three times. */
function NumberBox({ label, value, onCommit, testId }: { label: string; value: number | null; onCommit: (v: number | null) => void; testId?: string }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => setText(value == null ? "" : String(value)), [value]);
  const commit = () => {
    const n = text.trim() === "" ? null : Math.max(0, Math.floor(Number(text)));
    if (n === null || Number.isFinite(n)) onCommit(n);
  };
  return (
    <label className="ib-mini">
      {label}
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        data-testid={testId}
      />
    </label>
  );
}

/** INBOX-03: every filter. Each change applies at once and goes into the URL. */
export function FilterPanel({ query: q, facets, onChange }: { query: InboxQuery; facets: InboxFacetsJson | null; onChange: (patch: Partial<InboxQuery>) => void }) {
  return (
    <div id="inbox-filters" className="panel ib-filters" data-testid="filter-panel">
      <div className="ib-filter-grid">
        <div className="ib-filter">
          <FilterChips
            label="Rating"
            chips={[0, 1, 2, 3, 4, 5].map((r) => ({ id: String(r), label: stars(r) }))}
            selected={q.rating.map(String)}
            onChange={(ids) => onChange({ rating: ids.map(Number) })}
            testId="filter-rating"
          />
        </div>

        {facets && facets.tags.length > 0 && (
          <div className="ib-filter">
            <FilterChips label="Tags" chips={facets.tags.map((t) => ({ id: t, label: t }))} selected={q.tags} onChange={(tags) => onChange({ tags })} testId="filter-tags" />
            {q.tags.length > 1 && (
              <Segmented
                label="Match tags"
                options={[
                  { value: "any", label: "Any of them" },
                  { value: "all", label: "All of them" },
                ]}
                value={q.tagMode}
                onChange={(v) => onChange({ tagMode: v as InboxQuery["tagMode"] })}
              />
            )}
          </div>
        )}

        {facets && facets.platforms.length > 0 && (
          <div className="ib-filter">
            <FilterChips label="Source" chips={facets.platforms.map((p) => ({ id: p, label: cap(p) }))} selected={q.platform} onChange={(platform) => onChange({ platform })} testId="filter-platform" />
          </div>
        )}

        <div className="ib-filter">
          <FilterChips
            label="Added via"
            chips={INBOX_METHODS.map((m) => ({ id: m, label: METHOD_LABEL[m] }))}
            selected={q.method}
            onChange={(ids) => onChange({ method: ids as InboxMethod[] })}
            testId="filter-method"
          />
        </div>

        <div className="ib-filter ib-selects">
          <label className="ib-mini">
            Type
            <select value={q.type ?? ""} onChange={(e) => onChange({ type: (e.target.value || null) as InboxQuery["type"] })} data-testid="filter-type">
              <option value="">Any</option>
              <option value="text">{TYPE_LABEL.text}</option>
              <option value="video">{TYPE_LABEL.video}</option>
              <option value="image">{TYPE_LABEL.image}</option>
            </select>
          </label>
          {facets && facets.forms.length > 1 && (
            <label className="ib-mini">
              Form
              <select value={q.formId ?? ""} onChange={(e) => onChange({ formId: e.target.value || null })} data-testid="filter-form">
                <option value="">Any form</option>
                {facets.forms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {facets && facets.languages.length > 0 && (
            <label className="ib-mini">
              Language
              <select value={q.language ?? ""} onChange={(e) => onChange({ language: e.target.value || null })} data-testid="filter-language">
                <option value="">Any</option>
                {facets.languages.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="ib-mini">
            Consent covers
            <select value={q.scope ?? ""} onChange={(e) => onChange({ scope: (e.target.value || null) as InboxQuery["scope"] })} data-testid="filter-scope">
              <option value="">Anything</option>
              {(Object.keys(SCOPE_LABEL) as (keyof typeof SCOPE_LABEL)[]).map((s) => (
                <option key={s} value={s}>
                  {SCOPE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="ib-filter ib-selects">
          <NumberBox label="Words from" value={q.wordsMin} onCommit={(v) => onChange({ wordsMin: v })} testId="filter-words-min" />
          <NumberBox label="Words to" value={q.wordsMax} onCommit={(v) => onChange({ wordsMax: v })} testId="filter-words-max" />
          <label className="ib-mini">
            Added from
            <input type="date" value={q.from ?? ""} onChange={(e) => onChange({ from: e.target.value || null })} data-testid="filter-from" />
          </label>
          <label className="ib-mini">
            Added to
            <input type="date" value={q.to ?? ""} onChange={(e) => onChange({ to: e.target.value || null })} data-testid="filter-to" />
          </label>
        </div>

        <div className="ib-filter ib-checks">
          <Checkbox label="Has a photo" checked={q.hasAvatar} onChange={(v) => onChange({ hasAvatar: v })} />
          <Checkbox label="Has a company logo" checked={q.hasLogo} onChange={(v) => onChange({ hasLogo: v })} />
          <Checkbox label="Has images" checked={q.hasImages} onChange={(v) => onChange({ hasImages: v })} />
        </div>
      </div>
    </div>
  );
}
