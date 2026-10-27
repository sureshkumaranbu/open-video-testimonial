import { attr, cleanLine, cleanText, findAll, findOne, httpUrl, parseDom, parseSourceDate, stableId, textOf, type Element } from "../html";
import type { ImportedReview } from "../types";
import { savedPageSource } from "./_saved";

const hook = (name: string) => (e: Element) => attr(e, "data-hook") === name;

/** "4.0 out of 5 stars" → 4. */
function stars(text: string | undefined) {
  const m = /(\d+(?:[.,]\d)?)\s*(?:out of|von|sur|de|su)\s*(\d+)/i.exec(text ?? "");
  if (!m) return undefined;
  const n = Number(m[1].replace(",", "."));
  const best = Number(m[2]);
  const r = Math.round((n / best) * 5);
  return r >= 1 && r <= 5 ? r : undefined;
}

/** The reviews on a saved product page or "all reviews" page, marked with data-hook attributes. */
export function parseAmazon(html: string, base?: string): ImportedReview[] {
  const doc = parseDom(html);
  const out: ImportedReview[] = [];
  for (const el of findAll(doc, hook("review"))) {
    const name = cleanLine(textOf(findOne(el.children, (e) => (attr(e, "class") ?? "").split(/\s+/).includes("a-profile-name"))));
    const starEl = findOne(el.children, (e) => /review-star-rating$/.test(attr(e, "data-hook") ?? ""));
    const titleEl = findOne(el.children, hook("review-title"));
    // The title link starts with the stars' hidden text on some pages.
    const title = cleanLine(textOf(titleEl).replace(/^\s*\d+(?:[.,]\d)?\s*out of\s*\d+\s*stars?\s*/i, ""), 200);
    const body = cleanText(textOf(findOne(el.children, hook("review-body"))));
    const dateText = textOf(findOne(el.children, hook("review-date")));
    const date = parseSourceDate(/\bon\s+(.+)$/i.exec(dateText)?.[1] ?? dateText);
    if (!body && !title) continue;
    const href = titleEl && titleEl.name === "a" ? attr(titleEl, "href") : undefined;
    out.push({
      sourceReviewId: attr(el, "id") ?? stableId(name, dateText, body),
      authorName: name ?? "Amazon customer",
      rating: stars(textOf(starEl)),
      headline: title,
      text: body,
      url: httpUrl(href, base ?? "https://www.amazon.com"),
      date,
    });
  }
  return out;
}

/**
 * Amazon: a saved copy of your product's review page only. Amazon's terms
 * forbid automated collection and its product API shares no review text, so
 * Plaudit reads the page you save.
 */
export const amazon = savedPageSource({
  id: "amazon",
  label: "Amazon",
  tosNotes:
    "Amazon’s terms forbid automated collection and its product API shares no review text, so Plaudit never visits Amazon. Open your product’s reviews page, save it and upload it here. Import only reviews of products you sell.",
  parse: parseAmazon,
});
