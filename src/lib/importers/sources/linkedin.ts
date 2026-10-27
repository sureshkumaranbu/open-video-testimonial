import { attr, cleanLine, cleanText, findAll, httpUrl, parseDom, stableId } from "../html";
import type { ImportedReview } from "../types";
import { savedPageSource } from "./_saved";

/**
 * A post from the page's link preview tags (og:title "Name on LinkedIn:
 * …", og:description the words), for a saved post page without
 * structured data.
 */
export function ogPost(html: string, base?: string): ImportedReview[] {
  const doc = parseDom(html);
  const meta = (p: string) => {
    const el = findAll(doc, (e) => e.name === "meta" && (attr(e, "property") === p || attr(e, "name") === p))[0];
    return el ? attr(el, "content") : undefined;
  };
  const text = cleanText(meta("og:description") ?? meta("description"));
  const title = cleanLine(meta("og:title"), 300);
  if (!text || !title) return [];
  const name = cleanLine(/^(.+?)\s+(?:on|en|auf|sur)\s+LinkedIn\b/i.exec(title)?.[1] ?? title.split(/[:|–-]/)[0]);
  const url = httpUrl(meta("og:url")) ?? base;
  return [{ sourceReviewId: url ?? stableId(name, text), authorName: name ?? "LinkedIn member", text, url }];
}

/**
 * LinkedIn: a post someone wrote about you, from a page saved in your
 * browser. LinkedIn needs a login for most posts and forbids automated
 * collection, so Plaudit never fetches it. Reads the post's structured data
 * (and its comments when the page has them), else its link preview tags.
 */
export const linkedin = savedPageSource({
  id: "linkedin",
  label: "LinkedIn",
  tosNotes:
    "LinkedIn’s terms forbid automated collection and most posts need a login, so Plaudit never visits LinkedIn. Open the post, save the page and upload it here. Ask the author before you use their post if you’re not sure they’d mind.",
  fallback: ogPost,
});
