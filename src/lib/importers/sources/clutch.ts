import { z } from "zod";
import { reviewSite } from "./_page";

/**
 * Clutch: the schema.org reviews on a company's public profile
 * (clutch.co/profile/<slug>). Clutch sits behind bot protection, so when it
 * blocks us the saved page is the way in.
 */

const input = z
  .object({ url: z.string().trim().min(1, "Paste your Clutch profile").max(500) })
  .transform((v, ctx) => {
    const slug = /clutch\.co\/profile\/([a-z0-9][a-z0-9-]*)/i.exec(v.url)?.[1] ?? (/^[a-z0-9][a-z0-9-]*$/i.test(v.url) ? v.url : null);
    if (!slug) {
      ctx.addIssue({ code: "custom", message: "Use your company’s Clutch profile, like https://clutch.co/profile/your-company" });
      return z.NEVER;
    }
    return { slug: slug.toLowerCase() };
  });

export const clutch = {
  ...reviewSite({
    id: "clutch",
    label: "Clutch",
    tosNotes:
      "Reads the review data on your company’s public Clutch profile. Clutch often blocks automated visits: if it does, save the profile page in your browser and upload it. Import only your own company’s reviews.",
    fields: [{ key: "url", label: "Clutch profile", placeholder: "https://clutch.co/profile/your-company" }],
    input,
    origin: "https://clutch.co",
    path: (i, page) => `/profile/${encodeURIComponent(i.slug)}${page > 1 ? `?page=${page - 1}` : ""}`,
    maxPages: 20,
  }),
  feature: "imports2" as const,
};
