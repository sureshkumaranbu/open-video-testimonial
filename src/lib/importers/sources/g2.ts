import { z } from "zod";
import { reviewSite } from "./_page";

/**
 * G2: the schema.org reviews on a product's public reviews page
 * (g2.com/products/<slug>/reviews). G2 sits behind bot protection, so this
 * is best effort: when it blocks us, upload the saved page or use a CSV.
 */

const input = z
  .object({ url: z.string().trim().min(1, "Paste your G2 reviews page").max(500) })
  .transform((v, ctx) => {
    const slug = /g2\.com\/products\/([a-z0-9][a-z0-9-]*)/i.exec(v.url)?.[1] ?? (/^[a-z0-9][a-z0-9-]*$/i.test(v.url) ? v.url : null);
    if (!slug) {
      ctx.addIssue({ code: "custom", message: "Use your product’s G2 page, like https://www.g2.com/products/your-product/reviews" });
      return z.NEVER;
    }
    return { slug: slug.toLowerCase() };
  });

export const g2 = reviewSite({
  id: "g2",
  label: "G2",
  tosNotes:
    "Reads the review data on your product’s public G2 page. G2 usually blocks automated visits: if it does, save the reviews page in your browser and upload it, or export a CSV. Import only your own product’s reviews.",
  fields: [{ key: "url", label: "G2 reviews page", placeholder: "https://www.g2.com/products/your-product/reviews" }],
  input,
  origin: "https://www.g2.com",
  path: (i, page) => `/products/${encodeURIComponent(i.slug)}/reviews${page > 1 ? `?page=${page}` : ""}`,
  maxPages: 20,
});
