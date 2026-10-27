"use client";

import { useId } from "react";
import { Icon } from "@/components/Icon";
import { clampPage, pageCount, pageItems, pageRange } from "./paging";
import "@/app/admin/admin-kit.css";

/**
 * Page links for server-side pages; `page` counts from 1. Says which items
 * are showing ("26–50 of 312"), and on phones swaps the numbers for
 * "Page 2 of 13". Renders nothing when there are no items.
 */
export type PagerProps = {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  /** Shows a page-size picker when given. */
  pageSizes?: readonly number[];
  onPageSize?: (size: number) => void;
  /** Names the navigation landmark when a page has more than one pager. */
  label?: string;
  testId?: string;
};

/** One fixed locale, so the server and the browser print the same digits. */
const fmt = (n: number) => n.toLocaleString("en");

export function Pager({ page, pageSize, total, onPage, pageSizes, onPageSize, label = "Pages", testId }: PagerProps) {
  const id = useId();
  if (total <= 0) return null;
  const count = pageCount(total, pageSize);
  const current = clampPage(page, count);
  const { from, to } = pageRange(current, pageSize, total);
  const go = (p: number) => p !== current && p >= 1 && p <= count && onPage(p);

  return (
    <nav className="ak-pager" aria-label={label} data-testid={testId}>
      <p className="ak-pager-range" aria-live="polite">
        <span className="visually-hidden">Showing </span>
        {from === to ? fmt(from) : `${fmt(from)}–${fmt(to)}`} of {fmt(total)}
      </p>
      {count > 1 && (
        <div className="ak-pager-pages">
          <button
            type="button"
            className="secondary small"
            onClick={() => go(current - 1)}
            disabled={current <= 1}
            aria-label="Previous page"
          >
            <Icon name="chevronLeft" />
            <span className="hide-narrow">Previous</span>
          </button>
          <ul className="ak-pager-numbers">
            {pageItems(current, count).map((item, i) =>
              item === "gap" ? (
                <li key={`gap-${i}`} className="ak-pager-gap" aria-hidden>
                  …
                </li>
              ) : (
                <li key={item}>
                  <button
                    type="button"
                    className="ghost small"
                    aria-label={`Page ${item}`}
                    aria-current={item === current ? "page" : undefined}
                    onClick={() => go(item)}
                  >
                    {item}
                  </button>
                </li>
              ),
            )}
          </ul>
          <span className="ak-pager-compact">
            Page {current} of {count}
          </span>
          <button
            type="button"
            className="secondary small"
            onClick={() => go(current + 1)}
            disabled={current >= count}
            aria-label="Next page"
          >
            <span className="hide-narrow">Next</span>
            <Icon name="chevronRight" />
          </button>
        </div>
      )}
      {pageSizes && pageSizes.length > 1 && onPageSize && (
        <span className="ak-pager-size">
          <label htmlFor={`${id}-size`}>Per page</label>
          <select id={`${id}-size`} value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {pageSizes.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </span>
      )}
    </nav>
  );
}
