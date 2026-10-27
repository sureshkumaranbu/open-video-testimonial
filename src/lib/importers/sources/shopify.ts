import { z } from "zod";
import { reviewsFromPage } from "../jsonld-reviews";
import { ImporterBlockedError, ImporterInputError, type ImportedReview, type ImporterAdapter } from "../types";
import { fetchHtml } from "./_page";

/**
 * A Shopify store's product reviews, from the structured data its review app
 * adds to each product page for search engines (Judge.me, Loox, Okendo,
 * Yotpo, Stamped and Reviews.io all can). Paste the product pages; each one
 * is read once. When an app only draws reviews in the browser, save the page
 * with the reviews showing and upload it.
 */

const APPS: [RegExp, string][] = [
  [/judge\.me|jdgm/i, "Judge.me"],
  [/loox\.(io|app)/i, "Loox"],
  [/okendo/i, "Okendo"],
  [/yotpo/i, "Yotpo"],
  [/stamped\.io/i, "Stamped"],
  [/reviews\.(io|co\.uk)/i, "Reviews.io"],
];

/** Which review apps a page carries, by their scripts and markup (for the error message). */
export function reviewApps(html: string): string[] {
  return APPS.filter(([re]) => re.test(html)).map(([, name]) => name);
}

const input = z
  .object({ urls: z.string().trim().min(1, "Paste at least one product page").max(20_000) })
  .transform((v, ctx) => {
    const pages: string[] = [];
    for (const line of v.urls.split(/\s+/).filter(Boolean)) {
      let u: URL;
      try {
        u = new URL(/^https?:\/\//i.test(line) ? line : `https://${line}`);
      } catch {
        ctx.addIssue({ code: "custom", message: `“${line.slice(0, 60)}” isn't a web address` });
        return z.NEVER;
      }
      if (!/^https?:$/.test(u.protocol) || !/\/products\//.test(u.pathname)) {
        ctx.addIssue({ code: "custom", message: `“${line.slice(0, 60)}” isn't a product page (its address has /products/ in it)` });
        return z.NEVER;
      }
      u.search = "";
      u.hash = "";
      if (!pages.includes(u.toString())) pages.push(u.toString());
    }
    if (pages.length > 20) {
      ctx.addIssue({ code: "custom", message: "Paste at most 20 product pages at a time" });
      return z.NEVER;
    }
    return { pages };
  });
type Input = z.output<typeof input>;

export const shopify: ImporterAdapter = {
  id: "shopify",
  label: "Shopify store",
  platform: "shopify",
  kind: "platform",
  method: "structured-data",
  feature: "imports2",
  tosNotes:
    "Reads the review data your review app (Judge.me, Loox, Okendo, Yotpo, Stamped or Reviews.io) puts on your public product pages. Some apps only show reviews in the browser: then save the product page with its reviews showing and upload it, or export a CSV from the app. Use your own store’s pages.",
  fields: [{ key: "urls", label: "Product pages", type: "textarea", placeholder: "https://your-store.com/products/your-product", hint: "One per line, up to 20." }],
  input,
  async fetchPage(raw, cursor, ctx) {
    const { pages } = raw as Input;
    const i = cursor ? Math.max(0, Number(cursor) || 0) : 0;
    const page = pages[i];
    if (!page) return { items: [], next: null };
    const u = new URL(page);
    const url = `${ctx.origin(u.origin)}${u.pathname}`;
    const res = await fetchHtml(ctx, url, "The store");
    const items: ImportedReview[] = reviewsFromPage(res.text, page).map((r) => ({ ...r, url: r.url ?? page }));
    const next = i + 1 < pages.length ? String(i + 1) : null;
    if (i === 0 && items.length === 0 && !next) {
      const apps = reviewApps(res.text);
      if (apps.length) throw new ImporterBlockedError(`${apps.join(" and ")} on that page draws its reviews in the browser, so they aren't in the page Plaudit reads.`);
      throw new ImporterInputError("We couldn't find reviews on that product page. Check that its review app is installed, or upload the saved page.");
    }
    return { items, next };
  },
  parseHtml: (html) => reviewsFromPage(html),
};
