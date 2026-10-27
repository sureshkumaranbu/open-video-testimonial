import { z } from "zod";
import { DomUtils, parseDocument } from "htmlparser2";
import { cleanLine, cleanText, findAll, httpUrl, parseSourceDate, stableId, type Element } from "../html";
import { ImporterInputError, type ImportedReview, type ImporterAdapter } from "../types";

/**
 * WordPress.org plugin reviews from the plugin's official reviews feed
 * (wordpress.org/support/plugin/<slug>/reviews/feed/), page by page. No key.
 */

const MAX_PAGES = 10;

const input = z
  .object({ plugin: z.string().trim().min(1, "Paste your plugin’s WordPress.org link or slug").max(300) })
  .transform((v, ctx) => {
    const slug = /wordpress\.org\/(?:plugins|support\/plugin)\/([a-z0-9][a-z0-9-]{0,99})/i.exec(v.plugin)?.[1] ?? (/^[a-z0-9][a-z0-9-]{0,99}$/i.test(v.plugin) ? v.plugin : null);
    if (!slug) {
      ctx.addIssue({ code: "custom", message: "Use your plugin’s page, like https://wordpress.org/plugins/your-plugin/, or its slug" });
      return z.NEVER;
    }
    return { slug: slug.toLowerCase() };
  });
type Input = z.output<typeof input>;

const child = (el: Element, name: string) => el.children.find((c): c is Element => c.type === "tag" && (c as Element).name === name) as Element | undefined;
const text = (el: Element | undefined) => (el ? DomUtils.textContent(el).trim() : "");

/** The items of a reviews feed: the title, author, date and stars ("Rating: 4 stars"), and the words without the "Replies" and "Rating" lines. */
export function parseReviewFeed(xml: string): ImportedReview[] {
  const doc = parseDocument(xml, { xmlMode: true, decodeEntities: true });
  const out: ImportedReview[] = [];
  for (const item of findAll(doc, (e) => e.name === "item")) {
    const html = text(child(item, "description"));
    const rating = /Rating:\s*(\d)\s*star/i.exec(html)?.[1];
    const body = cleanText(html.replace(/<p>\s*(Replies|Rating):[^<]*<\/p>/gi, ""));
    const link = httpUrl(text(child(item, "link")));
    const author = cleanLine(text(child(item, "dc:creator")));
    const title = cleanLine(text(child(item, "title")), 200);
    if (!body && !title) continue;
    out.push({
      sourceReviewId: (text(child(item, "guid")) || link || stableId(author, title, body)).slice(0, 200),
      authorName: author ?? "WordPress.org user",
      rating: rating ? Number(rating) : undefined,
      headline: title,
      text: body,
      url: link,
      date: parseSourceDate(text(child(item, "pubDate"))),
    });
  }
  return out;
}

export const wordpress: ImporterAdapter = {
  id: "wordpress",
  label: "WordPress.org",
  platform: "wordpress",
  kind: "platform",
  method: "feed",
  feature: "imports2",
  tosNotes: "Reads the official reviews feed of your plugin on WordPress.org (no key). Import only reviews of your own plugin.",
  fields: [{ key: "plugin", label: "Plugin link or slug", placeholder: "https://wordpress.org/plugins/your-plugin/" }],
  input,
  async fetchPage(raw, cursor, ctx) {
    const { slug } = raw as Input;
    const page = cursor ? Math.max(1, Number(cursor) || 1) : 1;
    const res = await ctx.fetchText(`${ctx.origin("https://wordpress.org")}/support/plugin/${encodeURIComponent(slug)}/reviews/feed/${page > 1 ? `?paged=${page}` : ""}`, {
      headers: { accept: "application/rss+xml, application/xml;q=0.9" },
      timeoutMs: 10_000,
      maxBytes: 4 * 1024 * 1024,
    });
    if (res.status === 404) {
      if (page === 1) throw new ImporterInputError("WordPress.org has no plugin with that slug. Check the link.");
      return { items: [], next: null };
    }
    if (res.status !== 200) throw new Error(`WordPress.org answered ${res.status}`);
    const items = parseReviewFeed(res.text);
    return { items, next: items.length > 0 && page < MAX_PAGES ? String(page + 1) : null };
  },
};

