import { attr, cleanLine, cleanText, findAll, findOne, hasClass, httpUrl, parseDom, parseSourceDate, stableId, textOf, type Element } from "../html";
import type { ImportedReview } from "../types";
import { savedPageSource } from "./_saved";

const PLATFORMS = ["google", "facebook", "tripadvisor", "yelp", "trustpilot", "booking", "airbnb", "amazon", "capterra", "g2"];

/** The site a widget item was first posted on, from its class names or its platform icon. */
function platformOf(el: Element): string | undefined {
  const hay = [attr(el, "class") ?? "", attr(el, "data-platform") ?? "", ...findAll(el.children, (e) => e.name === "img").map((i) => `${attr(i, "src") ?? ""} ${attr(i, "alt") ?? ""}`)].join(" ").toLowerCase();
  return PLATFORMS.find((p) => hay.includes(p));
}

/** The reviews a Trustindex widget drew into a page you saved (its "ti-" markup). */
export function parseTrustindex(html: string, base?: string): ImportedReview[] {
  const doc = parseDom(html);
  const out: ImportedReview[] = [];
  for (const el of findAll(doc, hasClass("ti-review-item"))) {
    const name = cleanLine(textOf(findOne(el.children, hasClass("ti-name"))));
    const text = cleanText(textOf(findOne(el.children, (e) => hasClass("ti-review-content")(e) || hasClass("ti-review-text")(e))));
    const dateText = textOf(findOne(el.children, hasClass("ti-date")));
    const full = findAll(el.children, (e) => hasClass("ti-star")(e) && !hasClass("e")(e)).length;
    const given = Number(attr(el, "data-rating"));
    if (!text) continue;
    const avatar = findOne(el.children, (e) => e.name === "img" && /profile|avatar/i.test(`${attr(e, "class") ?? ""} ${attr(e, "alt") ?? ""}`));
    out.push({
      sourceReviewId: attr(el, "data-id") ?? stableId(name, dateText, text),
      authorName: name ?? "Reviewer",
      rating: Number.isInteger(given) && given >= 1 && given <= 5 ? given : full >= 1 && full <= 5 ? full : undefined,
      text,
      date: parseSourceDate(dateText),
      avatarUrl: avatar ? httpUrl(attr(avatar, "src"), base) : undefined,
      platform: platformOf(el),
    });
  }
  return out;
}

/**
 * Trustindex: the reviews its widget shows on your site, from a page you
 * saved with the widget on it. Each review keeps the site it came from
 * (Google, Facebook…) when the widget says.
 */
export const trustindex = savedPageSource({
  id: "trustindex",
  label: "Trustindex",
  tosNotes:
    "Reads the reviews a Trustindex widget shows on your own site, from that page saved in your browser (Plaudit doesn’t call Trustindex). Each review keeps the site it was first posted on when the widget shows it. Import only reviews of your own business.",
  parse: parseTrustindex,
});
