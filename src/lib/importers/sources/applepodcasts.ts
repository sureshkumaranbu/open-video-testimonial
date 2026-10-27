import { z } from "zod";
import { parseJson } from "../html";
import { ImporterInputError, type ImporterAdapter } from "../types";
import { parseFeed } from "./appstore";
import { reviewsFromSavedPage } from "./_saved";

/**
 * Apple Podcasts ratings and reviews from Apple's public customer-reviews
 * feed, the same one the App Store importer reads, for one country at a
 * time. Apple doesn't promise the feed for shows, so a saved copy of the
 * show's page is the fallback.
 */

const input = z
  .object({
    show: z.string().trim().min(1, "Paste your show’s Apple Podcasts link or ID").max(500),
    country: z.string().trim().max(2).optional(),
  })
  .transform((v, ctx) => {
    const id = /^\d{5,15}$/.test(v.show) ? v.show : /\/id(\d{5,15})(?:[/?#]|$)/.exec(v.show)?.[1];
    if (!id) {
      ctx.addIssue({ code: "custom", message: "Use your show’s link from Apple Podcasts. It ends in id followed by numbers, like …/id123456789" });
      return z.NEVER;
    }
    const country = (v.country || /podcasts\.apple\.com\/([a-z]{2})\//i.exec(v.show)?.[1] || "us").toLowerCase();
    if (!/^[a-z]{2}$/.test(country)) {
      ctx.addIssue({ code: "custom", message: "Use a two-letter country code, like us or gb" });
      return z.NEVER;
    }
    return { id, country };
  });
type Input = z.output<typeof input>;

export const applepodcasts: ImporterAdapter = {
  id: "applepodcasts",
  label: "Apple Podcasts",
  platform: "applepodcasts",
  kind: "platform",
  method: "feed",
  feature: "imports2",
  tosNotes: "Reads Apple’s public customer-reviews feed for your show, one country at a time (no key). If Apple’s feed is empty for your show, save the show’s page with the reviews showing and upload it. Import only your own show’s reviews.",
  fields: [
    { key: "show", label: "Apple Podcasts link or show ID", placeholder: "https://podcasts.apple.com/us/podcast/your-show/id123456789" },
    { key: "country", label: "Country", placeholder: "us", optional: true, hint: "Reviews are kept per country. Empty means the link’s country, or us." },
  ],
  input,
  async fetchPage(raw, cursor, ctx) {
    const show = raw as Input;
    const page = cursor ? Math.max(1, Number(cursor) || 1) : 1;
    const url = `${ctx.origin("https://itunes.apple.com")}/${show.country}/rss/customerreviews/page=${page}/id=${show.id}/sortby=mostrecent/json`;
    const res = await ctx.fetchText(url, { headers: { accept: "application/json" }, timeoutMs: 10_000, maxBytes: 5 * 1024 * 1024 });
    if (res.status === 400 || res.status === 404) {
      if (page === 1) throw new ImporterInputError(`Apple has no reviews feed for that show in ${show.country.toUpperCase()}. Check the link and the country, or upload the saved page.`);
      return { items: [], next: null };
    }
    if (res.status !== 200) throw new Error(`Apple answered ${res.status}`);
    const json = parseJson(res.text);
    if (json === undefined) throw new Error("Apple's answer wasn't readable");
    const { items, last } = parseFeed(json, show);
    const link = `https://podcasts.apple.com/${show.country}/podcast/id${show.id}`;
    return { items: items.map((i) => ({ ...i, url: link })), next: items.length > 0 && page < last ? String(page + 1) : null };
  },
  parseHtml: (html) => reviewsFromSavedPage(html, "https://podcasts.apple.com"),
};
