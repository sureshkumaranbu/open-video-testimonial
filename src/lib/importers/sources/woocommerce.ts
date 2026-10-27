import { z } from "zod";
import { cleanLine, cleanText, httpUrl, looksBlocked, parseJson, parseSourceDate, pick, toRating } from "../html";
import { ImporterBlockedError, ImporterInputError, type ImportedReview, type ImporterAdapter } from "../types";

/**
 * WooCommerce product reviews through the store's own public Store API
 * (/wp-json/wc/store/v1/products/reviews), which every WooCommerce shop has
 * and which needs no key. 100 a page, newest first, up to 1,000.
 */

const PER_PAGE = 100;
const MAX_PAGES = 10;

const input = z
  .object({ url: z.string().trim().min(1, "Paste your shop’s address").max(500) })
  .transform((v, ctx) => {
    const raw = /^https?:\/\//i.test(v.url) ? v.url : `https://${v.url}`;
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("protocol");
      // A shop in a folder (example.com/shop) keeps its folder.
      const path = u.pathname.replace(/\/(wp-json|shop|product|products)(\/.*)?$/i, "").replace(/\/+$/, "");
      return { origin: `${u.protocol}//${u.host}${path}` };
    } catch {
      ctx.addIssue({ code: "custom", message: "Use your shop’s address, like https://shop.example.com" });
      return z.NEVER;
    }
  });
type Input = z.output<typeof input>;
type Obj = Record<string, unknown>;

/** One page of Store API reviews. */
export function parseReviews(json: unknown): ImportedReview[] {
  if (!Array.isArray(json)) return [];
  const out: ImportedReview[] = [];
  for (const r of json as Obj[]) {
    const id = r.id;
    if (typeof id !== "number" && typeof id !== "string") continue;
    const avatars = (r.reviewer_avatar_urls ?? {}) as Record<string, unknown>;
    const product = cleanLine(r.product_name, 120);
    out.push({
      sourceReviewId: `review:${id}`,
      authorName: cleanLine(r.reviewer) ?? "Customer",
      avatarUrl: httpUrl(avatars["96"] ?? avatars["48"] ?? Object.values(avatars)[0]),
      rating: toRating(r.rating),
      headline: product ? `On ${product}` : undefined,
      text: cleanText(r.review),
      url: httpUrl(r.product_permalink),
      date: parseSourceDate(pick(r, "date_created_gmt") ? `${String(r.date_created_gmt)}Z` : r.date_created),
    });
  }
  return out;
}

export const woocommerce: ImporterAdapter = {
  id: "woocommerce",
  label: "WooCommerce",
  platform: "woocommerce",
  kind: "platform",
  method: "official-api",
  feature: "imports2",
  tosNotes: "Reads your shop’s product reviews through WooCommerce’s own public Store API (no key, nothing to install). Use your own shop’s address.",
  fields: [{ key: "url", label: "Your shop’s address", placeholder: "https://shop.example.com" }],
  input,
  async fetchPage(raw, cursor, ctx) {
    const { origin } = raw as Input;
    const page = cursor ? Math.max(1, Number(cursor) || 1) : 1;
    const base = ctx.origin(origin);
    const qs = `per_page=${PER_PAGE}&page=${page}&orderby=date_gmt&order=desc`;
    const get = (url: string) => ctx.fetchText(url, { headers: { accept: "application/json" }, timeoutMs: 12_000, maxBytes: 8 * 1024 * 1024 });
    let res = await get(`${base}/wp-json/wc/store/v1/products/reviews?${qs}`);
    // Shops without pretty links answer at ?rest_route= instead.
    if (res.status === 404) res = await get(`${base}/?rest_route=/wc/store/v1/products/reviews&${qs}`);
    if (res.status === 404) throw new ImporterInputError("That site has no WooCommerce Store API. Check the address, and that WooCommerce is up to date.");
    if (looksBlocked(res.status, res.text)) throw new ImporterBlockedError("The shop didn't let Plaudit read its reviews (a security plugin may block it).");
    // Asking past the last page.
    if (res.status === 400 && page > 1) return { items: [], next: null };
    if (res.status !== 200) throw new Error(`the shop answered ${res.status}`);
    const json = parseJson(res.text);
    if (!Array.isArray(json)) throw new ImporterInputError("That address didn't answer like a WooCommerce shop.");
    const items = parseReviews(json);
    return { items, next: json.length === PER_PAGE && page < MAX_PAGES ? String(page + 1) : null };
  },
};
