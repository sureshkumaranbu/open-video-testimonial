"use client";

import { useMemo, useState } from "react";
import { Segmented } from "@/components/admin";
import { Icon } from "@/components/Icon";
import { FEED_SORTS, FEED_TYPES, MAX_ITEMS, type ResolvedFilters } from "@/lib/widget-config";
import { setSection, type Draft, type Facets, type PickItem, type Update } from "./Studio";

const SORT_LABELS: Record<(typeof FEED_SORTS)[number], string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  rating: "Highest rated",
  manual: "Inbox pins, then newest",
  random: "Shuffled on each visit",
};

const TYPE_LABELS: Record<(typeof FEED_TYPES)[number], string> = { any: "Any", text: "Text", video: "Video", image: "With images" };

const words = (s: string) =>
  s
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 20);

/** Moves item `i` of `list` by `by` places. */
function move(list: string[], i: number, by: number) {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

type Props = { draft: Draft; update: Update; pickable: PickItem[]; facets: Facets };

/**
 * DISP-01 and DISP-02: auto (every approved one that matches) or a manual
 * pick list in your own order, pins that always come first, and the filters.
 * The pick list is kept when filters change; filters still apply to it.
 */
export function TestimonialsPanel({ draft, update, pickable, facets }: Props) {
  const sel = draft.config.selection;
  const f = draft.config.filters;
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(pickable.map((p) => [p.id, p])), [pickable]);
  const setSel = (patch: Partial<Draft["config"]["selection"]>) => setSection(update, "selection", patch);
  const setF = (patch: Partial<ResolvedFilters>) => setSection(update, "filters", patch);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? pickable.filter((p) => `${p.name} ${p.text}`.toLowerCase().includes(needle)) : pickable;
  }, [pickable, q]);

  const toggle = (list: "manualIds" | "pinnedIds", id: string, max: number) => {
    const cur = sel[list];
    setSel({ [list]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(0, max) });
  };
  const label = (id: string) => byId.get(id)?.name ?? "No longer approved";

  // A plain function, not a component: a component made inside render would remount (and drop focus) on every change.
  const ordered = (list: "manualIds" | "pinnedIds", title: string, testId: string, remove: string) => {
    const ids = sel[list];
    if (!ids.length) return null;
    return (
      <div className="stack" style={{ gap: "var(--space-1)" }}>
        <b className="small">{title}</b>
        <ol className="ws-list" data-testid={testId}>
          {ids.map((id, i) => (
            <li key={id} className="ws-item" data-id={id}>
              <span className="ws-item-text">
                {i + 1}. {label(id)}
              </span>
              <button type="button" className="secondary small" aria-label={`Move ${label(id)} up`} disabled={i === 0} onClick={() => setSel({ [list]: move(ids, i, -1) })}>
                ↑
              </button>
              <button
                type="button"
                className="secondary small"
                aria-label={`Move ${label(id)} down`}
                disabled={i === ids.length - 1}
                onClick={() => setSel({ [list]: move(ids, i, 1) })}
              >
                ↓
              </button>
              <button type="button" className="secondary small" aria-label={`${remove} ${label(id)}`} onClick={() => toggle(list, id, MAX_ITEMS)}>
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ol>
      </div>
    );
  };

  return (
    <div className="stack">
      <Segmented
        label="Which testimonials"
        options={[
          { value: "auto", label: "Automatic" },
          { value: "manual", label: "Hand-picked" },
        ]}
        value={sel.mode}
        onChange={(mode) => setSel({ mode })}
        testId="selection-mode"
      />
      <p className="ws-hint">
        {sel.mode === "auto"
          ? "Every approved testimonial that matches the filters below, newest ones included as they arrive."
          : "Only the ones you pick, in your order. The filters below still apply to them."}
      </p>

      {ordered("pinnedIds", "Pinned to the top", "pinned-list", "Unpin")}
      {sel.mode === "manual" && ordered("manualIds", "Picked, in this order", "picked-list", "Remove")}

      <fieldset className="ws-fieldset">
        <legend>Approved testimonials</legend>
        <label>
          Search
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or words" />
        </label>
        {pickable.length === 0 ? (
          <p className="ws-hint">Nothing is approved yet. Approve testimonials in the inbox and they appear here.</p>
        ) : (
          <ul className="ws-list ws-scroll" data-testid="pickable-list">
            {shown.map((p) => {
              const picked = sel.manualIds.includes(p.id);
              const pinned = sel.pinnedIds.includes(p.id);
              return (
                <li key={p.id} className="ws-item" data-pinned={pinned} data-id={p.id}>
                  <span className="ws-item-text" title={p.text}>
                    <b>{p.name}</b>
                    {p.rating ? ` · ${p.rating}★` : ""}
                    {p.video ? " · video" : ""} {p.text && <span className="muted">— {p.text}</span>}
                  </span>
                  {sel.mode === "manual" && (
                    <button type="button" className="secondary small" aria-pressed={picked} onClick={() => toggle("manualIds", p.id, MAX_ITEMS)}>
                      {picked ? "Picked" : "Pick"}
                      <span className="visually-hidden"> {p.name}</span>
                    </button>
                  )}
                  <button type="button" className="secondary small" aria-pressed={pinned} onClick={() => toggle("pinnedIds", p.id, 20)}>
                    {pinned ? "Pinned" : "Pin"}
                    <span className="visually-hidden"> {p.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      <fieldset className="ws-fieldset">
        <legend>Filters</legend>
        <div className="ws-two">
          <label>
            Lowest rating
            <select value={f.minRating} onChange={(e) => setF({ minRating: Number(e.target.value) })} data-testid="filter-min-rating">
              <option value={0}>Any (unrated too)</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}★ and up
                </option>
              ))}
            </select>
          </label>
          <label>
            Kind
            <select value={f.type} onChange={(e) => setF({ type: e.target.value as ResolvedFilters["type"] })}>
              {FEED_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Order
            <select value={f.sort} onChange={(e) => setF({ sort: e.target.value as ResolvedFilters["sort"] })} data-testid="filter-sort">
              {FEED_SORTS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Show at most
            <input
              type="number"
              min={1}
              max={MAX_ITEMS}
              value={f.max}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 1 && n <= MAX_ITEMS) setF({ max: n });
              }}
            />
          </label>
        </div>
        {facets.tags.length > 0 && (
          <div className="stack" style={{ gap: "var(--space-1)" }}>
            <span className="small">Tags</span>
            <div className="ws-chips" role="group" aria-label="Tags">
              {facets.tags.map((t) => {
                const on = f.tags.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    className="secondary small"
                    aria-pressed={on}
                    onClick={() => setF({ tags: on ? f.tags.filter((x) => x !== t) : [...f.tags, t] })}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
            {f.tags.length > 1 && (
              <Segmented
                label="Tags must match"
                options={[
                  { value: "any", label: "Any of them" },
                  { value: "all", label: "All of them" },
                ]}
                value={f.tagMode}
                onChange={(tagMode) => setF({ tagMode })}
              />
            )}
          </div>
        )}
        {facets.platforms.length > 0 && (
          <div className="stack" style={{ gap: "var(--space-1)" }}>
            <span className="small">Sources</span>
            <div className="ws-chips" role="group" aria-label="Sources">
              {facets.platforms.map((p) => {
                const on = f.platforms.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    className="secondary small"
                    aria-pressed={on}
                    onClick={() => setF({ platforms: on ? f.platforms.filter((x) => x !== p) : [...f.platforms, p] })}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <label>
          Must mention (comma-separated, any of them)
          <input type="text" defaultValue={f.include.join(", ")} onBlur={(e) => setF({ include: words(e.target.value) })} />
        </label>
        <label>
          Leave out ones that mention
          <input type="text" defaultValue={f.exclude.join(", ")} onBlur={(e) => setF({ exclude: words(e.target.value) })} />
        </label>
        <div className="ws-two">
          {facets.languages.length > 0 && (
            <label>
              Language
              <select value={f.language} onChange={(e) => setF({ language: e.target.value })}>
                <option value="">Any</option>
                {facets.languages.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
          {facets.forms.length > 0 && (
            <label>
              Sent through
              <select value={f.formId} onChange={(e) => setF({ formId: e.target.value })}>
                <option value="">Any form or source</option>
                {facets.forms.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </fieldset>
    </div>
  );
}
