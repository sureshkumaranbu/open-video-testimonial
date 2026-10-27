"use client";

import { SearchField, Segmented, Toggle } from "@/components/admin";
import { Icon } from "@/components/Icon";
import type { InboxPrefs, InboxQuery, InboxSort } from "@/lib/inbox-query";

const SORTS: { value: InboxSort; label: string }[] = [
  { value: "created", label: "Date added" },
  { value: "posted", label: "Date posted" },
  { value: "rating", label: "Rating" },
  { value: "name", label: "Name" },
  { value: "words", label: "Word count" },
];

/** How each sort reads in each direction, for the direction button. */
const DIR_LABEL: Record<InboxSort, { asc: string; desc: string }> = {
  created: { asc: "Oldest first", desc: "Newest first" },
  posted: { asc: "Oldest first", desc: "Newest first" },
  rating: { asc: "Lowest first", desc: "Highest first" },
  name: { asc: "A to Z", desc: "Z to A" },
  words: { asc: "Shortest first", desc: "Longest first" },
};

/** Search, the filter panel toggle, sort, card or table view, and exporting the view. */
export function InboxToolbar({
  query,
  view,
  filtersOpen,
  filterCount,
  onSearch,
  onToggleFilters,
  onSort,
  onView,
  exportHref,
  smart,
}: {
  query: InboxQuery;
  view: InboxPrefs["inboxView"];
  filtersOpen: boolean;
  filterCount: number;
  onSearch: (q: string) => void;
  onToggleFilters: () => void;
  onSort: (sort: InboxSort, dir: "asc" | "desc") => void;
  onView: (v: InboxPrefs["inboxView"]) => void;
  exportHref: (format: "csv" | "json") => string;
  /** INBOX-14 (aisearch flag): the "Smart search" switch. */
  smart?: { on: boolean; onChange: (on: boolean) => void };
}) {
  return (
    <div className="ib-toolbar" role="toolbar" aria-label="Inbox view">
      <div className="ib-search">
        <SearchField
          label="Search testimonials"
          value={query.q}
          onChange={onSearch}
          placeholder={smart?.on ? "Describe what you’re looking for…" : "Search names, words, tags…"}
          testId="inbox-search"
        />
      </div>
      {smart && <Toggle label="Smart search" checked={smart.on} onChange={smart.onChange} hint="By meaning, with your own AI provider" testId="smart-search" />}
      <button type="button" className="secondary small" aria-expanded={filtersOpen} aria-controls="inbox-filters" onClick={onToggleFilters} data-testid="filters-toggle">
        <Icon name="filter" />
        Filters{filterCount > 0 ? ` (${filterCount})` : ""}
      </button>
      <label className="ib-sort small">
        <span className="visually-hidden">Sort by</span>
        <select value={query.sort} onChange={(e) => onSort(e.target.value as InboxSort, e.target.value === "name" ? "asc" : "desc")} aria-label="Sort by" data-testid="inbox-sort">
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="ghost small"
        onClick={() => onSort(query.sort, query.dir === "asc" ? "desc" : "asc")}
        aria-label={`Sort direction: ${DIR_LABEL[query.sort][query.dir]}`}
        data-testid="inbox-sort-dir"
        data-dir={query.dir}
      >
        <Icon name="sort" />
        {DIR_LABEL[query.sort][query.dir]}
      </button>
      <Segmented
        label="View"
        options={[
          { value: "card", label: "Cards" },
          { value: "table", label: "Table" },
        ]}
        value={view}
        onChange={(v) => onView(v as InboxPrefs["inboxView"])}
        testId="inbox-view"
      />
      <details className="ib-export">
        <summary className="button ghost small">
          <Icon name="download" />
          Export
        </summary>
        <div className="ib-menu">
          <a href={exportHref("csv")} download data-testid="export-csv">
            This view as CSV
          </a>
          <a href={exportHref("json")} download data-testid="export-json">
            This view as JSON
          </a>
        </div>
      </details>
    </div>
  );
}
