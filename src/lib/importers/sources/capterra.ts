import { z } from "zod";
import { reviewSite } from "./_page";

/**
 * Capterra: the schema.org reviews on a product's public reviews page
 * (capterra.com/p/<id>/<slug>/reviews/). Best effort, like G2: it's behind
 * bot protection, and the saved-page upload or a CSV is the fallback.
 */

const input = z
  .object({ url: z.string().trim().min(1, "Paste your Capterra reviews page").max(500) })
  .transform((v, ctx) => {
    const m = /capterra\.[a-z.]+\/p\/(\d+)\/([a-z0-9][a-z0-9-]*)/i.exec(v.url);
    if (!m) {
      ctx.addIssue({ code: "custom", message: "Use your product’s Capterra page, like https://www.capterra.com/p/123456/YourProduct/reviews/" });
      return z.NEVER;
    }
    return { id: m[1], slug: m[2] };
  });

export const capterra = reviewSite({
  id: "capterra",
  label: "Capterra",
  tosNotes:
    "Reads the review data on your product’s public Capterra page. Capterra usually blocks automated visits: if it does, save the reviews page in your browser and upload it, or export a CSV. Import only your own product’s reviews.",
  fields: [{ key: "url", label: "Capterra reviews page", placeholder: "https://www.capterra.com/p/123456/YourProduct/reviews/" }],
  input,
  origin: "https://www.capterra.com",
  path: (i, page) => `/p/${i.id}/${encodeURIComponent(i.slug)}/reviews/${page > 1 ? `?page=${page}` : ""}`,
  maxPages: 10,
});
