import { z } from "zod";
import { reviewSite } from "./_page";

/**
 * Udemy: the schema.org reviews on a course's public page
 * (udemy.com/course/<slug>/). Udemy shows only a few there and loads the
 * rest in the browser, so for more, save the page after "Show all reviews".
 */

const input = z
  .object({ url: z.string().trim().min(1, "Paste your Udemy course page").max(500) })
  .transform((v, ctx) => {
    const slug = /udemy\.com\/course\/([a-z0-9][a-z0-9-]*)/i.exec(v.url)?.[1] ?? (/^[a-z0-9][a-z0-9-]*$/i.test(v.url) ? v.url : null);
    if (!slug) {
      ctx.addIssue({ code: "custom", message: "Use your course’s page, like https://www.udemy.com/course/your-course/" });
      return z.NEVER;
    }
    return { slug: slug.toLowerCase() };
  });

export const udemy = {
  ...reviewSite({
    id: "udemy",
    label: "Udemy",
    tosNotes:
      "Reads the review data on your course’s public Udemy page, which holds only a few reviews. For more, open the course, press “Show all reviews”, scroll, save the page and upload it. Import only your own course’s reviews.",
    fields: [{ key: "url", label: "Udemy course page", placeholder: "https://www.udemy.com/course/your-course/" }],
    input,
    origin: "https://www.udemy.com",
    path: (i) => `/course/${encodeURIComponent(i.slug)}/`,
    maxPages: 1,
  }),
  feature: "imports2" as const,
};
