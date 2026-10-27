import { z } from "zod";
import { parseCsvRecords } from "../../csv";
import { attr, cleanLine, cleanText, findAll, httpUrl, jsonLdBlocks, parseDom, parseSourceDate, stableId, textOf, type Element } from "../html";
import { reviewsFromJsonLd } from "../jsonld-reviews";
import { ImporterBlockedError, ImporterInputError, type ImportedReview, type ImporterAdapter } from "../types";
import { fetchHtml } from "./_page";

/**
 * Google Play has no public review API, so this is best effort: it reads
 * the reviews shown on the public store page (or a saved copy of it), and
 * the dependable way in is the reviews CSV from the Play Console
 * (Download reports → Reviews), which covers every review but has no
 * reviewer names.
 */

const PACKAGE = /^[a-zA-Z][\w]*(\.[a-zA-Z_][\w]*)+$/;

const input = z
  .object({ app: z.string().trim().min(1, "Paste your Google Play link or package name").max(500) })
  .transform((v, ctx) => {
    let pkg: string | null = null;
    try {
      pkg = new URL(v.app).searchParams.get("id");
    } catch {
      pkg = v.app;
    }
    if (!pkg || !PACKAGE.test(pkg)) {
      ctx.addIssue({ code: "custom", message: "Use your app’s Google Play link (…/details?id=com.example.app) or its package name" });
      return z.NEVER;
    }
    return { pkg };
  });
type Input = z.output<typeof input>;

/**
 * Reviews in a store page: each review's header carries data-review-id, its
 * stars are an image labelled "Rated N stars out of five stars", and the
 * text is the longest block in the review.
 */
export function parsePlayPage(html: string): ImportedReview[] {
  const doc = parseDom(html);
  const fromLd = reviewsFromJsonLd(jsonLdBlocks(doc));
  if (fromLd.length) return fromLd;
  const out: ImportedReview[] = [];
  const seen = new Set<string>();
  for (const marker of findAll(doc, (e) => attr(e, "data-review-id") !== undefined)) {
    const id = attr(marker, "data-review-id")!;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const box = (marker.name === "header" && marker.parent ? marker.parent : marker) as Element;
    const ratingEl = findAll(box, (e) => /rated \d/i.test(attr(e, "aria-label") ?? ""))[0];
    const rating = ratingEl ? Number(/rated (\d)/i.exec(attr(ratingEl, "aria-label")!)?.[1]) : undefined;
    const blocks = findAll(box, (e) => ["div", "p", "span"].includes(e.name) && e.children.every((c) => c.type === "text" || (c.type === "tag" && (c as Element).name === "br")))
      .map((e) => ({ e, text: textOf(e) }))
      .filter((b) => b.text);
    const dateBlock = blocks.find((b) => b.text.length < 40 && /\b(19|20)\d{2}\b/.test(b.text) && parseSourceDate(b.text));
    const img = findAll(marker, (e) => e.name === "img")[0];
    const name = cleanLine(blocks[0]?.text) ?? "Google Play user";
    const body = blocks.filter((b) => b !== blocks[0] && b !== dateBlock && !/people found this|helpful\?/i.test(b.text)).sort((a, b) => b.text.length - a.text.length)[0];
    out.push({
      sourceReviewId: id,
      authorName: name,
      avatarUrl: img ? httpUrl(attr(img, "src")) : undefined,
      rating: rating && rating >= 1 && rating <= 5 ? rating : undefined,
      text: cleanText(body?.text),
      date: dateBlock ? parseSourceDate(dateBlock.text) : undefined,
    });
  }
  return out;
}

/** The Play Console's reviews report (UTF-16 CSV; decoded before it gets here). */
export function parsePlayConsoleCsv(text: string): ImportedReview[] {
  const { headers, records } = parseCsvRecords(text);
  const has = (h: string) => headers.includes(h);
  if (!has("Star Rating") || !has("Review Text")) throw new Error("it isn't a Play Console reviews report (no Star Rating and Review Text columns)");
  const out: ImportedReview[] = [];
  for (const r of records) {
    const link = r["Review Link"] ?? "";
    const millis = r["Review Submit Millis Since Epoch"] || r["Review Last Update Millis Since Epoch"] || "";
    const id = /reviewid=([^&#\s]+)/i.exec(link)?.[1] ?? stableId(r["Package Name"], millis, r["Review Text"]);
    out.push({
      sourceReviewId: decodeURIComponent(id),
      // The report has no reviewer names.
      authorName: "Google Play user",
      authorTitle: cleanLine(r["Device"]) ? `On ${cleanLine(r["Device"])}` : undefined,
      rating: Number(r["Star Rating"]) >= 1 && Number(r["Star Rating"]) <= 5 ? Math.round(Number(r["Star Rating"])) : undefined,
      headline: cleanLine(r["Review Title"], 200),
      text: cleanText(r["Review Text"]),
      language: cleanLine(r["Reviewer Language"])?.slice(0, 16),
      date: parseSourceDate(millis ? Number(millis) : r["Review Submit Date and Time"]),
      url: httpUrl(link),
    });
  }
  return out;
}

export const googleplay: ImporterAdapter = {
  id: "googleplay",
  label: "Google Play",
  platform: "googleplay",
  kind: "platform",
  method: "page-parse",
  tosNotes:
    "Google Play has no public review API. We read the reviews on your app’s store page, which shows only a few; for all of them, download the reviews report from the Play Console and upload it. Import only your own app’s reviews.",
  fields: [{ key: "app", label: "Google Play link or package name", placeholder: "https://play.google.com/store/apps/details?id=com.example.app" }],
  input,
  upload: { accept: ".csv,text/csv", label: "Upload the Play Console reviews CSV" },
  async fetchPage(raw, _cursor, ctx) {
    const i = raw as Input;
    const url = `${ctx.origin("https://play.google.com")}/store/apps/details?id=${encodeURIComponent(i.pkg)}&hl=en&gl=US`;
    const res = await fetchHtml(ctx, url, "Google Play").catch((err) => {
      if (err instanceof ImporterInputError) throw new ImporterInputError("Google Play has no app with that package name.");
      throw err;
    });
    const items = parsePlayPage(res.text);
    if (!items.length) throw new ImporterBlockedError("We couldn't read reviews on that Google Play page. Upload the Play Console reviews CSV, or the saved page.");
    return { items, next: null };
  },
  parseHtml: parsePlayPage,
  parseFile: parsePlayConsoleCsv,
};
