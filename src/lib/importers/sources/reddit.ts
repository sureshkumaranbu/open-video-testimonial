import { z } from "zod";
import { cleanLine, cleanText, looksBlocked, parseJson, parseSourceDate } from "../html";
import { ImporterBlockedError, ImporterInputError, type ImportedReview, type ImporterAdapter } from "../types";
import { reviewsFromSavedPage } from "./_saved";

/**
 * A Reddit post and its top-level comments, from the post's public JSON
 * (reddit.com/comments/<id>.json). No key; Reddit limits how often it may
 * be read and may ask apps to register, so the saved page is the fallback.
 */

const input = z
  .object({ url: z.string().trim().min(1, "Paste the link to the Reddit post").max(500) })
  .transform((v, ctx) => {
    const id = /reddit\.com\/(?:r\/[^/]+\/)?comments\/([a-z0-9]{4,12})/i.exec(v.url)?.[1] ?? /redd\.it\/([a-z0-9]{4,12})/i.exec(v.url)?.[1];
    if (!id) {
      ctx.addIssue({ code: "custom", message: "Use a link to a post, like https://www.reddit.com/r/yoursub/comments/abc123/…" });
      return z.NEVER;
    }
    return { id: id.toLowerCase() };
  });
type Input = z.output<typeof input>;
type Obj = Record<string, unknown>;
type Thing = { kind?: string; data?: Obj };

const GONE = new Set(["[deleted]", "[removed]"]);
const BOTS = new Set(["automoderator"]);

/** The post (when it has words) and its top-level comments, skipping removed ones and bots. */
export function parseThread(json: unknown): ImportedReview[] {
  if (!Array.isArray(json)) return [];
  const [postListing, commentListing] = json as { data?: { children?: Thing[] } }[];
  const out: ImportedReview[] = [];
  const add = (d: Obj, kind: "post" | "comment") => {
    const author = String(d.author ?? "");
    const body = kind === "post" ? d.selftext : d.body;
    if (!author || GONE.has(author) || BOTS.has(author.toLowerCase()) || typeof body !== "string" || GONE.has(body.trim())) return;
    const text = cleanText(body);
    if (!text || typeof d.id !== "string") return;
    out.push({
      sourceReviewId: `${kind === "post" ? "t3" : "t1"}_${d.id}`,
      authorName: cleanLine(author) ?? "Redditor",
      authorTitle: `u/${author}`,
      headline: kind === "post" ? cleanLine(d.title, 200) : undefined,
      text,
      url: typeof d.permalink === "string" ? `https://www.reddit.com${d.permalink}` : undefined,
      date: parseSourceDate(typeof d.created_utc === "number" ? Math.round(d.created_utc) : undefined),
    });
  };
  const post = postListing?.data?.children?.[0];
  if (post?.kind === "t3" && post.data) add(post.data, "post");
  for (const c of commentListing?.data?.children ?? []) if (c.kind === "t1" && c.data) add(c.data, "comment");
  return out;
}

export const reddit: ImporterAdapter = {
  id: "reddit",
  label: "Reddit",
  platform: "reddit",
  kind: "platform",
  method: "feed",
  feature: "imports2",
  tosNotes:
    "Reads the post’s public JSON on Reddit: the post and its top-level comments (not replies, removed comments or bots). Reddit limits automated reading; if it blocks us, save the post’s page and upload it. Ask people before you use their comments if you’re not sure they’d mind.",
  fields: [{ key: "url", label: "Link to the post", placeholder: "https://www.reddit.com/r/yoursub/comments/abc123/…" }],
  input,
  async fetchPage(raw, _cursor, ctx) {
    const { id } = raw as Input;
    const res = await ctx.fetchText(`${ctx.origin("https://www.reddit.com")}/comments/${id}.json?limit=500&depth=1&sort=top&raw_json=1`, {
      headers: { accept: "application/json" },
      timeoutMs: 10_000,
      maxBytes: 8 * 1024 * 1024,
    });
    if (res.status === 404) throw new ImporterInputError("Reddit has no post at that link. Check it, and that the post isn't private.");
    if (looksBlocked(res.status, res.text)) throw new ImporterBlockedError("Reddit didn't let Plaudit read the post.");
    if (res.status !== 200) throw new Error(`Reddit answered ${res.status}`);
    const json = parseJson(res.text);
    if (json === undefined) throw new ImporterBlockedError("Reddit didn't answer with the post's data.");
    return { items: parseThread(json), next: null };
  },
  parseHtml: (html) => reviewsFromSavedPage(html, "https://www.reddit.com"),
};
