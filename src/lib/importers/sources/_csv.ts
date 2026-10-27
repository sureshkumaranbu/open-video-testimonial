import { parseCsvRecords } from "../../csv";
import { detectMapping, mapRows } from "../../csv-import";
import { parseSourceDate, stableId } from "../html";
import type { ImportedReview } from "../types";

/**
 * A testimonial tool's CSV export read with the CSV mapper's column
 * presets (Senja, Testimonial.to, Shapo headers), as importer items. Rows
 * without an id get a stable hash, so the same file imported twice dedupes.
 */
export function reviewsFromCsv(text: string, o: { senjaDates?: boolean } = {}): ImportedReview[] {
  const { headers, records } = parseCsvRecords(text);
  if (!headers.length) throw new Error("the file has no header row");
  const mapping = detectMapping(headers);
  if (!mapping.name || (!mapping.text && !mapping.videoUrl)) throw new Error("it needs at least a name column and a text or video column");
  const dateCol = mapping.date;
  return mapRows(records, mapping)
    .map((r, i): ImportedReview | null => {
      if (r.error) return null;
      const raw = dateCol ? records[i]?.[dateCol] : undefined;
      const date = o.senjaDates ? senjaDate(raw) : parseSourceDate(raw);
      return {
        sourceReviewId: r.sourceReviewId ?? stableId(r.name, raw ?? "", r.text ?? r.videoUrl ?? ""),
        authorName: r.name,
        authorTitle: r.title ?? undefined,
        headline: r.headline ?? undefined,
        authorCompany: r.company ?? undefined,
        avatarUrl: r.avatarUrl ?? undefined,
        rating: r.rating ?? undefined,
        text: r.text ?? undefined,
        videoUrl: r.videoUrl ?? undefined,
        date,
        platform: r.platform ?? undefined,
      };
    })
    .filter((r): r is ImportedReview => r !== null);
}

/**
 * Senja stores a review whose source gave only a month as the 22nd of that
 * month at midnight UTC. We can't tell those apart from a real 22nd, so a
 * date exactly then is kept as the month only (IMP-05): "Oct 2026", never a
 * made-up day.
 */
export function senjaDate(raw: unknown) {
  const d = parseSourceDate(raw);
  if (!d || d.precision !== "day") return d;
  const v = d.value;
  if (v.getUTCDate() === 22 && v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0) {
    return { value: new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), 1)), precision: "month" as const };
  }
  return d;
}
