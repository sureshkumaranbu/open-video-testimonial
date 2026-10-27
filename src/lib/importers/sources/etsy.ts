import { z } from "zod";
import { env } from "../../env";
import { cleanText, httpUrl, parseJson, parseSourceDate, toRating } from "../html";
import { ImporterInputError, type ImportedReview, type ImporterAdapter } from "../types";

/**
 * Etsy shop reviews through Etsy's Open API v3 with the owner's own key
 * (ETSY_API_KEY): getReviewsByShop, 100 at a time, up to 1,000. Etsy's API
 * doesn't share buyers' names, so they import as "Etsy buyer".
 */

const PER_PAGE = 100;

const input = z
  .object({ shop: z.string().trim().min(1, "Paste your Etsy shop link, name or ID").max(300) })
  .transform((v, ctx) => {
    const fromUrl = /etsy\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?shop\/([A-Za-z0-9]{2,40})/i.exec(v.shop)?.[1];
    const s = fromUrl ?? v.shop;
    if (/^\d{3,15}$/.test(s)) return { shopId: s, name: null };
    if (/^[A-Za-z0-9]{2,40}$/.test(s)) return { shopId: null, name: s };
    ctx.addIssue({ code: "custom", message: "Use your shop’s link (etsy.com/shop/YourShop), its name or its number" });
    return z.NEVER;
  });
type Input = z.output<typeof input>;
type Obj = Record<string, unknown>;

export function parseShopReviews(json: unknown): { items: ImportedReview[]; count: number } {
  const o = (json ?? {}) as Obj;
  const items: ImportedReview[] = [];
  for (const r of Array.isArray(o.results) ? (o.results as Obj[]) : []) {
    const id = r.transaction_id ?? r.listing_id;
    const text = cleanText(r.review);
    const rating = toRating(r.rating);
    if ((typeof id !== "number" && typeof id !== "string") || (!text && rating === undefined)) continue;
    items.push({
      sourceReviewId: `${String(id)}:${String(r.created_timestamp ?? r.create_timestamp ?? "")}`,
      authorName: "Etsy buyer",
      rating,
      text,
      language: typeof r.language === "string" ? r.language : undefined,
      url: r.listing_id ? `https://www.etsy.com/listing/${String(r.listing_id)}` : undefined,
      imageUrls: [httpUrl(r.image_url_fullxfull)].filter((u): u is string => Boolean(u)),
      date: parseSourceDate(typeof r.created_timestamp === "number" ? r.created_timestamp : r.create_timestamp),
    });
  }
  return { items, count: typeof o.count === "number" ? o.count : items.length };
}

export const etsy: ImporterAdapter = {
  id: "etsy",
  label: "Etsy",
  platform: "etsy",
  kind: "platform",
  method: "official-api",
  feature: "imports2",
  tosNotes: "Uses Etsy’s Open API with your own key (ETSY_API_KEY). Etsy doesn’t share buyers’ names, so reviews import as “Etsy buyer”. Import only your own shop’s reviews.",
  fields: [{ key: "shop", label: "Etsy shop link, name or ID", placeholder: "https://www.etsy.com/shop/YourShop" }],
  input,
  unavailable: () => (env.etsyApiKey ? null : "Needs ETSY_API_KEY"),
  async fetchPage(raw, cursor, ctx) {
    const i = raw as Input;
    const origin = ctx.origin("https://openapi.etsy.com");
    const call = async (path: string) => {
      const res = await ctx.fetchText(`${origin}${path}`, { headers: { accept: "application/json", "x-api-key": env.etsyApiKey }, timeoutMs: 10_000, maxBytes: 4 * 1024 * 1024 });
      if (res.status === 401 || res.status === 403) throw new ImporterInputError("Etsy refused the API key. Check ETSY_API_KEY.");
      if (res.status === 404) throw new ImporterInputError("Etsy doesn't know that shop. Check the link or name.");
      if (res.status !== 200) throw new Error(`Etsy answered ${res.status}`);
      return parseJson(res.text) as Obj | undefined;
    };
    let shopId = i.shopId;
    const c = cursor ? (parseJson(cursor) as { shop: string; offset: number } | undefined) : undefined;
    if (c) shopId = c.shop;
    if (!shopId) {
      const found = await call(`/v3/application/shops?shop_name=${encodeURIComponent(i.name!)}&limit=1`);
      const first = Array.isArray(found?.results) ? (found!.results as Obj[])[0] : undefined;
      if (!first?.shop_id) throw new ImporterInputError("Etsy found no shop by that name. Paste the shop’s link instead.");
      shopId = String(first.shop_id);
    }
    const offset = c?.offset ?? 0;
    const json = await call(`/v3/application/shops/${encodeURIComponent(shopId)}/reviews?limit=${PER_PAGE}&offset=${offset}`);
    const { items, count } = parseShopReviews(json);
    const next = offset + PER_PAGE < count && items.length > 0 ? JSON.stringify({ shop: shopId, offset: offset + PER_PAGE }) : null;
    return { items, next, total: count };
  },
};
