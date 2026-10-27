import { z } from "zod";
import { DomUtils } from "htmlparser2";
import { attr, cleanLine, cleanText, findAll, httpUrl, jsonLdBlocks, parseDom, parseJson, parseSourceDate, pick, stableId, toRating } from "../html";
import { reviewsFromJsonLd, reviewsFromMicrodata } from "../jsonld-reviews";
import { ImporterInputError, type AdapterId, type ImportedReview, type ImporterAdapter } from "../types";

/**
 * Sources that only work from a page saved in the owner's browser (M13): the
 * site needs a login (Facebook, LinkedIn) or its terms forbid automated
 * visits and it blocks them (Yelp, Amazon, Airbnb…). Plaudit never fetches
 * these sites; it reads the file the owner uploads, in this order: schema.org
 * reviews (JSON-LD, then microdata), schema.org posts and comments, then
 * review-shaped objects in the page's embedded data. A source can put its
 * own reader first.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

function* walk(v: unknown, seen = new Set<unknown>(), depth = 0): Generator<Obj> {
  if (!v || typeof v !== "object" || seen.has(v) || depth > 15) return;
  seen.add(v);
  if (Array.isArray(v)) {
    for (const x of v) yield* walk(x, seen, depth + 1);
    return;
  }
  yield v as Obj;
  for (const x of Object.values(v as Obj)) if (x && typeof x === "object") yield* walk(x, seen, depth + 1);
}

const POST_TYPES = new Set(["socialmediaposting", "discussionforumposting", "comment", "answer"]);

/** schema.org posts and comments (SocialMediaPosting, DiscussionForumPosting, Comment) as reviews without stars. */
export function postingsFromJsonLd(blocks: unknown[], base?: string): ImportedReview[] {
  const out: ImportedReview[] = [];
  const ids = new Set<string>();
  for (const o of walk(blocks)) {
    const types = asList(o["@type"]).map((t) => String(t).replace(/^.*[/#]/, "").toLowerCase());
    if (!types.some((t) => POST_TYPES.has(t))) continue;
    const text = cleanText(o.articleBody ?? o.text ?? o.description);
    if (!text) continue;
    const author = asList(o.author)[0];
    const authorName = cleanLine(isObj(author) ? (author.name ?? author.alternateName) : author) ?? "Anonymous";
    const rawDate = String(o.datePublished ?? o.dateCreated ?? "");
    const raw = typeof o["@id"] === "string" ? o["@id"] : typeof o.identifier === "string" ? o.identifier : httpUrl(o.url, base);
    const id = (raw || stableId(authorName, rawDate, text)).slice(0, 200);
    if (ids.has(id)) continue;
    ids.add(id);
    out.push({
      sourceReviewId: id,
      authorName,
      avatarUrl: isObj(author) ? httpUrl(asList(author.image)[0] as string | undefined) : undefined,
      headline: cleanLine(o.headline, 200),
      text,
      url: httpUrl(o.url, base),
      date: parseSourceDate(o.datePublished ?? o.dateCreated),
      language: typeof o.inLanguage === "string" ? o.inLanguage.slice(0, 16) : undefined,
    });
  }
  return out;
}

const NAME_KEYS = ["recommender.name", "reviewerName", "reviewer_name", "authorName", "author_name", "displayName", "display_name", "userName", "username", "customerName", "name", "reviewer.name", "reviewer.firstName", "reviewer.displayName", "author.name", "author.displayName", "user.name", "user.displayName", "customer.name", "buyer.name"];
const TEXT_KEYS = ["story.message.text", "message.text", "reviewText", "review_text", "reviewBody", "comments", "comment", "review", "text", "body", "content", "message"];
const RATING_KEYS = ["rating", "stars", "starRating", "score", "overallRating", "rating.value", "rating.rating"];
const DATE_KEYS = ["created_time", "createdAt", "created_at", "date", "datePublished", "publishedAt", "submittedAt", "reviewDate", "localizedDate", "time"];

/** A review-shaped object from a page's embedded data, read by the names sites commonly use. */
export function reviewFromLoose(o: Obj): ImportedReview | null {
  const name = cleanLine(pick(o, ...NAME_KEYS));
  const textRaw = pick(o, ...TEXT_KEYS);
  const text = typeof textRaw === "string" ? cleanText(textRaw) : undefined;
  if (!name || !text || text.length < 2) return null;
  const rawDate = pick(o, ...DATE_KEYS);
  const id = pick(o, "id", "reviewId", "review_id", "uuid");
  return {
    sourceReviewId: typeof id === "string" || typeof id === "number" ? String(id) : stableId(name, String(rawDate ?? ""), text),
    authorName: name,
    rating: toRating(pick(o, ...RATING_KEYS), pick(o, "rating.max", "maxRating", "bestRating") ?? 5),
    headline: cleanLine(pick(o, "title", "headline", "summary"), 200),
    text,
    avatarUrl: httpUrl(pick(o, "avatarUrl", "avatar_url", "reviewer.pictureUrl", "reviewer.avatar", "author.avatar", "user.avatar", "profileImage", "photo")),
    date: parseSourceDate(rawDate),
  };
}

/** Every JSON blob in the page's scripts (Next.js data, Apollo caches, inline state). */
function embeddedJson(html: string): unknown[] {
  const doc = parseDom(html);
  const out: unknown[] = [];
  for (const el of findAll(doc, (e) => e.name === "script" && !/ld\+json/i.test(attr(e, "type") ?? ""))) {
    const raw = DomUtils.textContent(el).trim();
    if (!raw || raw.length > 8 * 1024 * 1024) continue;
    const direct = /^[[{]/.test(raw) ? parseJson(raw) : undefined;
    if (direct !== undefined) {
      out.push(direct);
      continue;
    }
    // window.__STATE__ = {...};
    const m = /=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(raw);
    if (m) {
      const v = parseJson(m[1]);
      if (v !== undefined) out.push(v);
    }
  }
  return out;
}

const NAME_HINT = /name|reviewer|recommender|author|user|customer|buyer/i;

/** Review-shaped objects anywhere in the embedded data, each once. */
export function reviewsFromEmbedded(html: string, max = 2000): ImportedReview[] {
  const out: ImportedReview[] = [];
  const ids = new Set<string>();
  for (const blob of embeddedJson(html)) {
    for (const o of walk(blob)) {
      if (out.length >= max) return out;
      if (!Object.keys(o).some((k) => NAME_HINT.test(k))) continue;
      const r = reviewFromLoose(o);
      if (!r || ids.has(r.sourceReviewId)) continue;
      ids.add(r.sourceReviewId);
      out.push(r);
    }
  }
  return out;
}

/** The generic reading of a saved page: the first of these that finds anything. */
export function reviewsFromSavedPage(html: string, base?: string): ImportedReview[] {
  const doc = parseDom(html);
  const blocks = jsonLdBlocks(doc);
  for (const read of [
    () => reviewsFromJsonLd(blocks, base),
    () => reviewsFromMicrodata(doc, base),
    () => postingsFromJsonLd(blocks, base),
    () => reviewsFromEmbedded(html),
  ]) {
    const items = read();
    if (items.length) return items;
  }
  return [];
}

/** The page's own address, from its canonical link or og:url (a saved page keeps them). */
export function canonicalUrl(html: string): string | undefined {
  const doc = parseDom(html);
  const link = findAll(doc, (e) => e.name === "link" && (attr(e, "rel") ?? "").split(/\s+/).includes("canonical"))[0];
  const og = findAll(doc, (e) => e.name === "meta" && attr(e, "property") === "og:url")[0];
  return httpUrl(link ? attr(link, "href") : undefined) ?? httpUrl(og ? attr(og, "content") : undefined);
}

export type SavedPageSpec = {
  id: AdapterId;
  label: string;
  /** Defaults to the id. */
  platform?: string;
  tosNotes: string;
  /** Read before the generic reading; return [] to fall through to it. */
  parse?(html: string, base?: string): ImportedReview[];
  /** Read when the generic reading finds nothing. */
  fallback?(html: string, base?: string): ImportedReview[];
};

/** A source that takes only a saved copy of its page. */
export function savedPageSource(spec: SavedPageSpec): ImporterAdapter {
  return {
    id: spec.id,
    label: spec.label,
    platform: spec.platform ?? spec.id,
    kind: "platform",
    method: "saved-page",
    tosNotes: spec.tosNotes,
    fields: [],
    input: z.object({}).passthrough(),
    feature: "imports2",
    savedPageOnly: true,
    async fetchPage() {
      throw new ImporterInputError(`Plaudit doesn't visit ${spec.label} itself. Save the page in your browser and upload it below.`);
    },
    parseHtml(html) {
      const base = canonicalUrl(html);
      const own = spec.parse?.(html, base) ?? [];
      if (own.length) return own;
      const generic = reviewsFromSavedPage(html, base);
      return generic.length ? generic : (spec.fallback?.(html, base) ?? []);
    },
  };
}
