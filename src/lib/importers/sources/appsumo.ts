import { z } from "zod";
import { reviewSite } from "./_page";

/**
 * AppSumo: the schema.org reviews on a product's public page
 * (appsumo.com/products/<slug>/). Best effort: when the page has none, or
 * AppSumo blocks us, upload the saved reviews page.
 */

const input = z
  .object({ url: z.string().trim().min(1, "Paste your AppSumo product page").max(500) })
  .transform((v, ctx) => {
    const slug = /appsumo\.com\/products\/([a-z0-9][a-z0-9-]*)/i.exec(v.url)?.[1] ?? (/^[a-z0-9][a-z0-9-]*$/i.test(v.url) ? v.url : null);
    if (!slug) {
      ctx.addIssue({ code: "custom", message: "Use your product’s AppSumo page, like https://appsumo.com/products/your-product/" });
      return z.NEVER;
    }
    return { slug: slug.toLowerCase() };
  });

export const appsumo = {
  ...reviewSite({
    id: "appsumo",
    label: "AppSumo",
    tosNotes:
      "Reads the review data on your product’s public AppSumo page. If the page shows its reviews only in the browser, or AppSumo blocks us, save the reviews page and upload it. Import only your own product’s reviews.",
    fields: [{ key: "url", label: "AppSumo product page", placeholder: "https://appsumo.com/products/your-product/" }],
    input,
    origin: "https://appsumo.com",
    path: (i, page) => `/products/${encodeURIComponent(i.slug)}/reviews/${page > 1 ? `?page=${page}` : ""}`,
    maxPages: 10,
  }),
  feature: "imports2" as const,
};
