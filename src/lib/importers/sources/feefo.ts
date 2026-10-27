import { z } from "zod";
import { cleanLine, cleanText, httpUrl, parseJson, parseSourceDate, pick, toRating } from "../html";
import { ImporterInputError, type ImportedReview, type ImporterAdapter } from "../types";

/**
 * Feefo reviews through Feefo's public reviews API (api.feefo.com/api/20),
 * which shares a merchant's published reviews without a key: the service
 * review and each product review of an order, 100 a page.
 */

const PER_PAGE = 100;
const MAX_PAGES = 10;

const input = z
  .object({ merchant: z.string().trim().min(1, "Paste your Feefo reviews page or merchant identifier").max(300) })
  .transform((v, ctx) => {
    const fromUrl = /feefo\.com\/(?:[a-z]{2}-[a-z]{2}\/)?reviews\/([a-z0-9][a-z0-9_-]{1,99})/i.exec(v.merchant)?.[1];
    const id = fromUrl ?? (/^[a-z0-9][a-z0-9_-]{1,99}$/i.test(v.merchant) ? v.merchant : null);
    if (!id) {
      ctx.addIssue({ code: "custom", message: "Use your Feefo reviews page (feefo.com/en-GB/reviews/your-business) or your merchant identifier" });
      return z.NEVER;
    }
    return { merchant: id };
  });
type Input = z.output<typeof input>;
type Obj = Record<string, unknown>;

/** A page of the API's reviews: one item for the service review, one per product review. */
export function parseFeefo(json: unknown): { items: ImportedReview[]; pages: number } {
  const o = (json ?? {}) as Obj;
  const items: ImportedReview[] = [];
  for (const r of Array.isArray(o.reviews) ? (o.reviews as Obj[]) : []) {
    const name = cleanLine(pick(r, "customer.display_name")) ?? "Feefo customer";
    const where = cleanLine(pick(r, "customer.display_location"));
    const url = httpUrl(r.url);
    const service = (r.service ?? null) as Obj | null;
    if (service && typeof service.id === "string" && (service.review || pick(service, "rating.rating"))) {
      items.push({
        sourceReviewId: `service:${service.id}`,
        authorName: name,
        authorTitle: where,
        rating: toRating(pick(service, "rating.rating"), pick(service, "rating.max") ?? 5),
        headline: cleanLine(service.title, 200),
        text: cleanText(service.review),
        url,
        date: parseSourceDate(service.created_at),
      });
    }
    for (const p of Array.isArray(r.products) ? (r.products as Obj[]) : []) {
      if (typeof p.id !== "string" || !(p.review || pick(p, "rating.rating"))) continue;
      const product = cleanLine(pick(p, "product.title"), 120);
      items.push({
        sourceReviewId: `product:${p.id}`,
        authorName: name,
        authorTitle: where,
        rating: toRating(pick(p, "rating.rating"), pick(p, "rating.max") ?? 5),
        headline: product ? `On ${product}` : undefined,
        text: cleanText(p.review),
        url,
        date: parseSourceDate(p.created_at),
      });
    }
  }
  const pages = Number(pick(o, "summary.meta.pages"));
  return { items, pages: Number.isInteger(pages) && pages > 0 ? pages : 1 };
}

export const feefo: ImporterAdapter = {
  id: "feefo",
  label: "Feefo",
  platform: "feefo",
  kind: "platform",
  method: "official-api",
  feature: "imports2",
  tosNotes: "Reads your published reviews through Feefo’s public reviews API (no key): the service review and each product review. Import only your own business’s reviews.",
  fields: [{ key: "merchant", label: "Feefo reviews page or merchant identifier", placeholder: "https://www.feefo.com/en-GB/reviews/your-business" }],
  input,
  async fetchPage(raw, cursor, ctx) {
    const { merchant } = raw as Input;
    const page = cursor ? Math.max(1, Number(cursor) || 1) : 1;
    const res = await ctx.fetchText(`${ctx.origin("https://api.feefo.com")}/api/20/reviews/all?merchant_identifier=${encodeURIComponent(merchant)}&page_size=${PER_PAGE}&page=${page}`, {
      headers: { accept: "application/json" },
      timeoutMs: 10_000,
      maxBytes: 8 * 1024 * 1024,
    });
    if (res.status === 400 || res.status === 404) throw new ImporterInputError("Feefo doesn't know that merchant. Check the identifier in your Feefo reviews page’s address.");
    if (res.status !== 200) throw new Error(`Feefo answered ${res.status}`);
    const { items, pages } = parseFeefo(parseJson(res.text));
    const last = Math.min(pages, MAX_PAGES);
    return { items, next: items.length > 0 && page < last ? String(page + 1) : null };
  },
};
