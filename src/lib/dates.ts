import type { DatePrecision } from "@/db/schema";

/**
 * Small text helpers shared by the server and the dashboard (client-safe: no
 * Node APIs, and only types come from the database schema).
 */

const FORMATS: Record<DatePrecision, Intl.DateTimeFormatOptions> = {
  day: { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" },
  month: { month: "short", year: "numeric", timeZone: "UTC" },
  year: { year: "numeric", timeZone: "UTC" },
};

/**
 * A review's original date as exactly as it's known: "12 Oct 2026", "Oct 2026"
 * or "2026". Dates are read in UTC, because an import that only knows the month
 * stores the 1st at midnight UTC, which is still the previous month west of it.
 */
export function formatSourceDate(d: Date, p: DatePrecision, locale: string): string {
  const options = FORMATS[p] ?? FORMATS.day;
  try {
    return new Intl.DateTimeFormat(locale, options).format(d);
  } catch {
    // An unknown or malformed locale tag.
    return new Intl.DateTimeFormat("en", options).format(d);
  }
}

/**
 * Words in a piece of text: runs of letters, digits and joining marks, so
 * "don't", "e-mail" and "3.5" count once and punctuation never counts. This is
 * the only definition: testimonials.word_count is filled from it on every write
 * and by the maintenance backfill.
 */
export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  return text.match(/[\p{L}\p{N}\p{M}]+(?:['’.\-][\p{L}\p{N}\p{M}]+)*/gu)?.length ?? 0;
}
