/** Page arithmetic for Pager (server-side pages that count from 1). */

/** How many pages `total` items fill; at least 1, so page 1 always exists. */
export function pageCount(total: number, pageSize: number) {
  if (!(pageSize > 0)) return 1;
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

/** `page` kept within 1..pageCount. */
export function clampPage(page: number, count: number) {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), Math.max(1, count));
}

/** The 1-based item numbers a page shows ("26–50 of 312"); 0–0 when there are none. */
export function pageRange(page: number, pageSize: number, total: number) {
  if (total <= 0 || pageSize <= 0) return { from: 0, to: 0 };
  const p = clampPage(page, pageCount(total, pageSize));
  return { from: (p - 1) * pageSize + 1, to: Math.min(total, p * pageSize) };
}

export type PageItem = number | "gap";

/**
 * The page links to show: always the first and last, the current page with
 * `siblings` either side, and a gap for each run that's left out. A gap never
 * stands in for a single page (that page is shown instead), so the row keeps
 * the same length as you move through the middle.
 */
export function pageItems(page: number, count: number, siblings = 1): PageItem[] {
  const total = Math.max(1, count);
  const current = clampPage(page, total);
  // first + last + current + siblings + two gaps
  const slots = 2 * siblings + 5;
  if (total <= slots) return Array.from({ length: total }, (_, i) => i + 1);

  const start = Math.max(2, Math.min(current - siblings, total - 1 - 2 * siblings - 1));
  const end = Math.min(total - 1, Math.max(current + siblings, 2 + 2 * siblings + 1));
  const items: PageItem[] = [1];
  if (start > 2) items.push(start === 3 ? 2 : "gap");
  for (let i = start; i <= end; i++) items.push(i);
  if (end < total - 1) items.push(end === total - 2 ? total - 1 : "gap");
  items.push(total);
  return items;
}
