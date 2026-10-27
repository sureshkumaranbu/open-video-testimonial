import { z } from "zod";
import { attr, cleanLine, cleanText, findAll, parseDom, parseJson, parseSourceDate, textOf } from "../html";
import { ImporterInputError, type ImportedReview, type ImporterAdapter } from "../types";

/**
 * X (Twitter) posts, one link at a time, through the official oEmbed
 * endpoint (publish.twitter.com/oembed), which needs no key and works for
 * public posts only. Paste up to 50 links, one per line.
 */

const STATUS = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/i;
const PER_PAGE = 10;

const input = z
  .object({ urls: z.string().trim().min(1, "Paste at least one link to a post on X").max(20_000) })
  .transform((v, ctx) => {
    const lines = v.urls.split(/[\s,]+/).filter(Boolean);
    const posts: { handle: string; id: string }[] = [];
    for (const line of lines) {
      const m = STATUS.exec(line);
      if (!m) {
        ctx.addIssue({ code: "custom", message: `“${line.slice(0, 60)}” isn't a link to a post on X (x.com/name/status/123…)` });
        return z.NEVER;
      }
      if (!posts.some((p) => p.id === m[2])) posts.push({ handle: m[1], id: m[2] });
    }
    if (posts.length > 50) {
      ctx.addIssue({ code: "custom", message: "Paste at most 50 links at a time" });
      return z.NEVER;
    }
    return { posts };
  });
type Input = z.output<typeof input>;

type OEmbed = { author_name?: string; author_url?: string; html?: string; url?: string };

/** One post from its oEmbed answer: the text and language from the quote, the date from its last link. */
export function parseOEmbed(json: OEmbed, post: { handle: string; id: string }): ImportedReview | null {
  if (!json.html) return null;
  const doc = parseDom(json.html);
  const p = findAll(doc, (e) => e.name === "p")[0];
  const links = findAll(doc, (e) => e.name === "a");
  const dateText = links.length ? textOf(links[links.length - 1]) : "";
  const handle = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i.exec(json.author_url ?? "")?.[1] ?? post.handle;
  const text = cleanText(p ? textOf(p) : undefined);
  if (!text) return null;
  return {
    sourceReviewId: post.id,
    authorName: cleanLine(json.author_name) ?? `@${handle}`,
    authorTitle: `@${handle}`,
    text,
    language: p ? attr(p, "lang")?.slice(0, 16) || undefined : undefined,
    url: `https://x.com/${handle}/status/${post.id}`,
    date: parseSourceDate(dateText),
  };
}

export const x: ImporterAdapter = {
  id: "x",
  label: "X",
  platform: "x",
  kind: "platform",
  method: "oembed",
  tosNotes: "Uses X’s official embed endpoint for each post link you paste, so only public posts work. Import posts about your own product, and ask the author if you’re not sure they’d mind.",
  fields: [{ key: "urls", label: "Links to posts", type: "textarea", placeholder: "https://x.com/someone/status/1234567890", hint: "One per line, up to 50." }],
  input,
  async fetchPage(raw, cursor, ctx) {
    const { posts } = raw as Input;
    const start = cursor ? Math.max(0, Number(cursor) || 0) : 0;
    const slice = posts.slice(start, start + PER_PAGE);
    const items: ImportedReview[] = [];
    for (const post of slice) {
      const link = `https://twitter.com/${post.handle}/status/${post.id}`;
      const res = await ctx.fetchText(`${ctx.origin("https://publish.twitter.com")}/oembed?url=${encodeURIComponent(link)}&omit_script=true&dnt=true`, {
        headers: { accept: "application/json" },
        timeoutMs: 8000,
        maxBytes: 256 * 1024,
      });
      // A deleted, private or protected post: leave it out.
      if (res.status === 404 || res.status === 403) continue;
      if (res.status !== 200) throw new Error(`X answered ${res.status}`);
      const item = parseOEmbed((parseJson(res.text) ?? {}) as OEmbed, post);
      if (item) items.push(item);
    }
    const next = start + PER_PAGE < posts.length ? String(start + PER_PAGE) : null;
    if (start === 0 && items.length === 0 && !next) throw new ImporterInputError("We couldn't read those posts. Check that they're public and the links are right.");
    return { items, next };
  },
};
