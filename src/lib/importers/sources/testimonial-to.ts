import { z } from "zod";
import { findReviewLike, jsonLdBlocks, parseDom, scriptJson } from "../html";
import { reviewsFromJsonLd } from "../jsonld-reviews";
import { ImporterBlockedError, ImporterInputError, type ImportedReview, type ImporterAdapter } from "../types";
import { reviewsFromCsv } from "./_csv";
import { reviewFromObject } from "./_json";
import { fetchHtml } from "./_page";

/**
 * Moving from Testimonial.to: the public Wall of Love page (text and video
 * testimonials that are on the wall), read from the page's embedded data,
 * or their CSV export, which also has the ones that aren't on the wall.
 * Videos come across through import.media.
 */

const input = z
  .object({ url: z.string().trim().min(1, "Paste your Wall of Love link").max(500) })
  .transform((v, ctx) => {
    let u: URL;
    try {
      u = new URL(/^https?:\/\//i.test(v.url) ? v.url : `https://${v.url}`);
    } catch {
      ctx.addIssue({ code: "custom", message: "Use your Wall of Love link, like https://testimonial.to/your-space/all" });
      return z.NEVER;
    }
    const host = u.hostname.toLowerCase();
    const space = u.pathname.split("/").filter(Boolean)[0];
    if (!/(^|\.)testimonial\.to$/.test(host) || !space || !/^[\w-]{1,100}$/.test(space)) {
      ctx.addIssue({ code: "custom", message: "Use your Wall of Love link, like https://testimonial.to/your-space/all" });
      return z.NEVER;
    }
    return { space };
  });
type Input = z.output<typeof input>;

/** Testimonials on a wall page: JSON-LD reviews if any, else the testimonial-shaped objects in its embedded data. */
export function parseWall(html: string): ImportedReview[] {
  const doc = parseDom(html);
  const embedded = scriptJson(doc, "__NEXT_DATA__");
  const fromData = findReviewLike(embedded)
    .map((o) => reviewFromObject(o))
    .filter((r): r is ImportedReview => r !== null);
  if (fromData.length) return fromData;
  return reviewsFromJsonLd(jsonLdBlocks(doc));
}

export const testimonialTo: ImporterAdapter = {
  id: "testimonial-to",
  label: "Testimonial.to",
  platform: "testimonial-to",
  kind: "migration",
  method: "page-parse",
  tosNotes: "Reads your public Wall of Love, so only testimonials on the wall come across. For all of them, export a CSV from Testimonial.to and upload it. Bring only your own testimonials.",
  fields: [{ key: "url", label: "Wall of Love link", placeholder: "https://testimonial.to/your-space/all" }],
  input,
  upload: { accept: ".csv,text/csv", label: "Upload the Testimonial.to CSV export" },
  async fetchPage(raw, _cursor, ctx) {
    const i = raw as Input;
    const url = `${ctx.origin("https://testimonial.to")}/${encodeURIComponent(i.space)}/all`;
    const res = await fetchHtml(ctx, url, "Testimonial.to").catch((err) => {
      if (err instanceof ImporterInputError) throw new ImporterInputError("Testimonial.to has no Wall of Love at that link.");
      throw err;
    });
    const items = parseWall(res.text);
    if (!items.length) throw new ImporterBlockedError("We couldn't find testimonials on that Wall of Love. Upload the CSV export, or the saved page.");
    return { items, next: null };
  },
  parseHtml: parseWall,
  parseFile: (text) => reviewsFromCsv(text),
};
