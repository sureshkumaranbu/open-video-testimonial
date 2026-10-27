import { z } from "zod";
import { env } from "../../env";
import { cleanLine, cleanText, httpUrl, parseJson, parseSourceDate, pick } from "../html";
import { ImporterInputError, type ImportedReview, type ImporterAdapter } from "../types";

/**
 * YouTube, through Google's official endpoints. With the owner's own Data
 * API key (YOUTUBE_API_KEY) it imports the comments on each video (newest
 * first, up to 1,000 per run); without one, each video link imports as a
 * testimonial of its own (title, channel and link from YouTube's oEmbed),
 * for videos people made about you. The video itself stays on YouTube.
 */

const ID = /^[A-Za-z0-9_-]{11}$/;

/** The 11-character video id from a watch, short, embed or youtu.be link, or the id itself. */
export function videoId(raw: string): string | null {
  const s = raw.trim();
  if (ID.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    if (host === "youtu.be") return ID.test(u.pathname.slice(1, 12)) ? u.pathname.slice(1, 12) : null;
    if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
    const v = u.searchParams.get("v");
    if (v && ID.test(v)) return v;
    const m = /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/.exec(u.pathname);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const input = z
  .object({ urls: z.string().trim().min(1, "Paste at least one YouTube video link").max(10_000) })
  .transform((v, ctx) => {
    const ids: string[] = [];
    for (const line of v.urls.split(/[\s,]+/).filter(Boolean)) {
      const id = videoId(line);
      if (!id) {
        ctx.addIssue({ code: "custom", message: `“${line.slice(0, 60)}” isn't a YouTube video link` });
        return z.NEVER;
      }
      if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length > 20) {
      ctx.addIssue({ code: "custom", message: "Paste at most 20 video links at a time" });
      return z.NEVER;
    }
    return { ids };
  });
type Input = z.output<typeof input>;
type Obj = Record<string, unknown>;

/** One page of a video's comment threads (Data API v3 commentThreads.list). */
export function parseComments(json: unknown, video: string): { items: ImportedReview[]; next: string | null } {
  const o = (json ?? {}) as Obj;
  const items: ImportedReview[] = [];
  for (const t of Array.isArray(o.items) ? (o.items as Obj[]) : []) {
    const c = (pick(t, "snippet.topLevelComment") ?? {}) as Obj;
    const id = typeof c.id === "string" ? c.id : typeof t.id === "string" ? t.id : null;
    const text = cleanText(pick(c, "snippet.textOriginal", "snippet.textDisplay"));
    if (!id || !text) continue;
    items.push({
      sourceReviewId: id,
      authorName: cleanLine(pick(c, "snippet.authorDisplayName"))?.replace(/^@/, "") ?? "YouTube viewer",
      avatarUrl: httpUrl(pick(c, "snippet.authorProfileImageUrl")),
      text,
      url: `https://www.youtube.com/watch?v=${video}&lc=${encodeURIComponent(id)}`,
      date: parseSourceDate(pick(c, "snippet.publishedAt")),
    });
  }
  return { items, next: typeof o.nextPageToken === "string" ? o.nextPageToken : null };
}

/** A video as a testimonial of its own, from its oEmbed answer. */
export function parseVideo(json: unknown, video: string): ImportedReview | null {
  const o = (json ?? {}) as Obj;
  const title = cleanLine(o.title, 200);
  if (!title) return null;
  return {
    sourceReviewId: `video:${video}`,
    authorName: cleanLine(o.author_name) ?? "YouTube creator",
    headline: title,
    url: `https://www.youtube.com/watch?v=${video}`,
  };
}

type Cursor = { i: number; t: string | null };

export const youtube: ImporterAdapter = {
  id: "youtube",
  label: "YouTube",
  platform: "youtube",
  kind: "platform",
  method: "official-api",
  feature: "imports2",
  tosNotes:
    "Uses YouTube’s official endpoints. With your own Data API key (YOUTUBE_API_KEY) it imports the comments on each video; without one, each video imports as a testimonial that links to it (title and channel). The videos stay on YouTube. Ask creators before you use their videos.",
  fields: [{ key: "urls", label: "Video links", type: "textarea", placeholder: "https://www.youtube.com/watch?v=…", hint: "One per line, up to 20." }],
  input,
  async fetchPage(raw, cursor, ctx) {
    const { ids } = raw as Input;
    const c: Cursor = cursor ? ((parseJson(cursor) as Cursor | undefined) ?? { i: 0, t: null }) : { i: 0, t: null };
    const video = ids[c.i];
    if (!video) return { items: [], next: null };
    const nextVideo = () => (c.i + 1 < ids.length ? JSON.stringify({ i: c.i + 1, t: null }) : null);

    if (!env.youtubeApiKey) {
      const link = `https://www.youtube.com/watch?v=${video}`;
      const res = await ctx.fetchText(`${ctx.origin("https://www.youtube.com")}/oembed?url=${encodeURIComponent(link)}&format=json`, { headers: { accept: "application/json" }, timeoutMs: 8000, maxBytes: 256 * 1024 });
      // A private, removed or embed-blocked video: leave it out.
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        if (ids.length === 1) throw new ImporterInputError("YouTube can't show that video. Check that it's public.");
        return { items: [], next: nextVideo() };
      }
      if (res.status !== 200) throw new Error(`YouTube answered ${res.status}`);
      const item = parseVideo(parseJson(res.text), video);
      return { items: item ? [item] : [], next: nextVideo() };
    }

    const qs = new URLSearchParams({ part: "snippet", videoId: video, maxResults: "100", order: "time", textFormat: "plainText", key: env.youtubeApiKey });
    if (c.t) qs.set("pageToken", c.t);
    const res = await ctx.fetchText(`${ctx.origin("https://www.googleapis.com")}/youtube/v3/commentThreads?${qs}`, { headers: { accept: "application/json" }, timeoutMs: 10_000, maxBytes: 4 * 1024 * 1024 });
    const json = parseJson(res.text) as Obj | undefined;
    const errors = pick(json ?? {}, "error.errors");
    const reason = Array.isArray(errors) ? String((errors[0] as Obj | undefined)?.reason ?? "") : "";
    if (res.status === 403 && /commentsDisabled/i.test(reason)) return { items: [], next: nextVideo() };
    if (res.status === 404) {
      if (ids.length === 1) throw new ImporterInputError("YouTube doesn't know that video. Check the link.");
      return { items: [], next: nextVideo() };
    }
    if (res.status === 400 || res.status === 403) throw new ImporterInputError("YouTube refused the API key. Check YOUTUBE_API_KEY and that the YouTube Data API v3 is enabled for it.");
    if (res.status !== 200 || !json) throw new Error(`YouTube answered ${res.status}`);
    const page = parseComments(json, video);
    return { items: page.items, next: page.next ? JSON.stringify({ i: c.i, t: page.next }) : nextVideo() };
  },
};
