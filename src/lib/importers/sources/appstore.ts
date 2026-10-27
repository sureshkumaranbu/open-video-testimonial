import { z } from "zod";
import { cleanLine, cleanText, parseJson, parseSourceDate, toRating } from "../html";
import { ImporterInputError, type ImportedReview, type ImporterAdapter } from "../types";

/**
 * App Store reviews from Apple's public customer-reviews RSS feed (JSON
 * flavour): itunes.apple.com/<cc>/rss/customerreviews/page=<n>/id=<app>/sortby=mostrecent/json.
 * 50 reviews a page, at most 10 pages, one country at a time. No key needed.
 */

type Label = { label?: string; attributes?: Record<string, string> };
type Entry = {
  id?: Label;
  author?: { name?: Label; uri?: Label };
  updated?: Label;
  title?: Label;
  content?: Label;
  "im:rating"?: Label;
  "im:version"?: Label;
};
type Feed = { feed?: { entry?: Entry | Entry[]; link?: { attributes?: { rel?: string; href?: string } }[] | { attributes?: { rel?: string; href?: string } } } };

export const MAX_PAGES = 10;

const input = z
  .object({
    app: z.string().trim().min(1, "Paste your App Store link or app ID").max(500),
    country: z.string().trim().max(2).optional(),
  })
  .transform((v, ctx) => {
    const id = /^\d{5,15}$/.test(v.app) ? v.app : /\/id(\d{5,15})(?:[/?#]|$)/.exec(v.app)?.[1];
    if (!id) {
      ctx.addIssue({ code: "custom", message: "That doesn't look like an App Store link. It ends in id followed by numbers, like …/id123456789" });
      return z.NEVER;
    }
    const fromUrl = /apps\.apple\.com\/([a-z]{2})\//i.exec(v.app)?.[1];
    const country = (v.country || fromUrl || "us").toLowerCase();
    if (!/^[a-z]{2}$/.test(country)) {
      ctx.addIssue({ code: "custom", message: "Use a two-letter country code, like us or gb" });
      return z.NEVER;
    }
    return { id, country };
  });
type Input = z.output<typeof input>;

function lastPage(feed: Feed["feed"]): number {
  const links = Array.isArray(feed?.link) ? feed.link : feed?.link ? [feed.link] : [];
  const last = links.find((l) => l.attributes?.rel === "last")?.attributes?.href;
  const n = last ? Number(/page=(\d+)/.exec(last)?.[1]) : NaN;
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_PAGES) : MAX_PAGES;
}

export function parseFeed(json: unknown, app: Input): { items: ImportedReview[]; last: number } {
  const feed = (json as Feed | null)?.feed;
  const entries = Array.isArray(feed?.entry) ? feed.entry : feed?.entry ? [feed.entry] : [];
  const items: ImportedReview[] = [];
  for (const e of entries) {
    // Older feeds start with the app itself, which has no rating.
    const rating = toRating(e["im:rating"]?.label);
    const id = e.id?.label;
    if (rating === undefined || !id) continue;
    items.push({
      sourceReviewId: id,
      authorName: cleanLine(e.author?.name?.label) ?? "App Store user",
      rating,
      headline: cleanLine(e.title?.label, 200),
      text: cleanText(e.content?.label),
      url: `https://apps.apple.com/${app.country}/app/id${app.id}?see-all=reviews`,
      date: parseSourceDate(e.updated?.label),
    });
  }
  return { items, last: lastPage(feed) };
}

export const appstore: ImporterAdapter = {
  id: "appstore",
  label: "App Store",
  platform: "appstore",
  kind: "platform",
  method: "feed",
  tosNotes: "Reads Apple’s public customer-reviews feed for one country: the latest 500 reviews at most. Import only your own app’s reviews.",
  fields: [
    { key: "app", label: "App Store link or app ID", placeholder: "https://apps.apple.com/us/app/your-app/id123456789", type: "text" },
    { key: "country", label: "Country", placeholder: "us", optional: true, hint: "Reviews are kept per country. Empty means the link’s country, or us." },
  ],
  input,
  async fetchPage(raw, cursor, ctx) {
    const app = raw as Input;
    const page = cursor ? Math.max(1, Number(cursor) || 1) : 1;
    const url = `${ctx.origin("https://itunes.apple.com")}/${app.country}/rss/customerreviews/page=${page}/id=${app.id}/sortby=mostrecent/json`;
    const res = await ctx.fetchText(url, { headers: { accept: "application/json" }, timeoutMs: 10_000, maxBytes: 5 * 1024 * 1024 });
    if (res.status === 400 || res.status === 404) {
      if (page === 1) throw new ImporterInputError(`We couldn't find that app in the ${app.country.toUpperCase()} App Store. Check the link and the country.`);
      return { items: [], next: null };
    }
    if (res.status !== 200) throw new Error(`the App Store answered ${res.status}`);
    const json = parseJson(res.text);
    if (json === undefined) throw new Error("the App Store's answer wasn't readable");
    const { items, last } = parseFeed(json, app);
    return { items, next: items.length > 0 && page < last ? String(page + 1) : null };
  },
};
