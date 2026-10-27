import { z } from "zod";
import { cleanLine, cleanText, httpUrl, jsonLdBlocks, parseDom, parseSourceDate, pick, scriptJson, toRating } from "../html";
import { reviewsFromJsonLd } from "../jsonld-reviews";
import type { ImportedReview } from "../types";
import { reviewSite } from "./_page";

/**
 * Trustpilot: the schema.org review data on the public business page
 * (trustpilot.com/review/<domain>), 20 reviews a page, with the page's own
 * embedded data as a second reading. Trustpilot often blocks automated
 * visits, so the saved-page upload is the dependable way in.
 */

const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const input = z
  .object({ url: z.string().trim().min(1, "Paste your Trustpilot page or your website’s domain").max(500) })
  .transform((v, ctx) => {
    const raw = v.url.toLowerCase();
    const fromUrl = /trustpilot\.com\/review\/([^/?#\s]+)/.exec(raw)?.[1];
    const domain = decodeURIComponent(fromUrl ?? raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, ""));
    if (!DOMAIN.test(domain)) {
      ctx.addIssue({ code: "custom", message: "Use your Trustpilot page (trustpilot.com/review/yoursite.com) or your site’s domain" });
      return z.NEVER;
    }
    return { domain };
  });

type Obj = Record<string, unknown>;

/** The reviews in the page's embedded data (used when it carries no JSON-LD reviews). */
function fromEmbedded(json: unknown): { items: ImportedReview[]; lastPage?: number } {
  const props = (pick((json ?? {}) as Obj, "props.pageProps") ?? {}) as Obj;
  const list = Array.isArray(props.reviews) ? (props.reviews as Obj[]) : [];
  const items: ImportedReview[] = [];
  for (const r of list) {
    const id = pick(r, "id");
    if (typeof id !== "string" || !id) continue;
    items.push({
      sourceReviewId: id,
      authorName: cleanLine(pick(r, "consumer.displayName", "consumer.name")) ?? "Trustpilot reviewer",
      avatarUrl: httpUrl(pick(r, "consumer.imageUrl")),
      rating: toRating(pick(r, "rating", "stars")),
      headline: cleanLine(pick(r, "title"), 200),
      text: cleanText(pick(r, "text", "content")),
      date: parseSourceDate(pick(r, "dates.publishedDate", "dates.experiencedDate", "createdAt")),
      language: typeof r.language === "string" ? r.language : undefined,
      url: `https://www.trustpilot.com/reviews/${encodeURIComponent(id)}`,
    });
  }
  const total = Number(pick(props, "filters.pagination.totalPages"));
  return { items, lastPage: Number.isInteger(total) && total > 0 ? total : undefined };
}

export function parseTrustpilot(html: string, url: string) {
  const doc = parseDom(html);
  const embedded = fromEmbedded(scriptJson(doc, "__NEXT_DATA__"));
  // The structured data's @id ends in the same review id the embedded data uses, so both readings dedupe alike.
  const ld = reviewsFromJsonLd(jsonLdBlocks(doc), url).map((r) => ({ ...r, sourceReviewId: /([a-f0-9]{24})$/i.exec(r.sourceReviewId)?.[1] ?? r.sourceReviewId }));
  return { items: ld.length ? ld : embedded.items, lastPage: embedded.lastPage };
}

export const trustpilot = reviewSite({
  id: "trustpilot",
  label: "Trustpilot",
  tosNotes:
    "Reads the review data Trustpilot publishes on your public business page. Trustpilot limits automated visits, so if it blocks us, save the page in your browser and upload it. Import only your own business’s reviews.",
  fields: [{ key: "url", label: "Trustpilot page or domain", placeholder: "https://www.trustpilot.com/review/yoursite.com" }],
  input,
  origin: "https://www.trustpilot.com",
  path: (i, page) => `/review/${encodeURIComponent(i.domain)}${page > 1 ? `?page=${page}` : ""}`,
  maxPages: 50,
  parse: parseTrustpilot,
});
