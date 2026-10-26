import type { Document } from "domhandler";
import { attr, cleanLine, cleanText, findAll, httpUrl, jsonLdBlocks, parseDom, parseSourceDate, stableId, textOf, toRating, type Element } from "./html";
import type { ImportedReview } from "./types";

/**
 * Reviews from schema.org structured data, the way most review sites
 * publish them for search engines: JSON-LD first, then microdata. Shared by
 * the page-parse adapters and the "Upload the saved page" fallback.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

function types(o: Obj): string[] {
  return asList(o["@type"]).map((t) => String(t).replace(/^.*[/#]/, "").toLowerCase());
}

/** Every object in the blocks (through @graph and nested values), each once. */
function* walk(v: unknown, seen = new Set<unknown>(), depth = 0): Generator<Obj> {
  if (!v || typeof v !== "object" || seen.has(v) || depth > 15) return;
  seen.add(v);
  if (Array.isArray(v)) {
    for (const x of v) yield* walk(x, seen, depth + 1);
    return;
  }
  const o = v as Obj;
  yield o;
  for (const x of Object.values(o)) if (x && typeof x === "object") yield* walk(x, seen, depth + 1);
}

function nameOf(v: unknown): string | undefined {
  if (typeof v === "string") return cleanLine(v);
  if (Array.isArray(v)) return nameOf(v[0]);
  if (isObj(v)) return cleanLine(v.name ?? v.alternateName);
  return undefined;
}

function imageOf(v: unknown): string | undefined {
  if (typeof v === "string") return httpUrl(v);
  if (Array.isArray(v)) return imageOf(v[0]);
  if (isObj(v)) return httpUrl(v.url ?? v.contentUrl);
  return undefined;
}

function idOf(o: Obj, base: string | undefined, author: string, date: string, body: string) {
  const raw = typeof o["@id"] === "string" ? o["@id"] : typeof o.identifier === "string" || typeof o.identifier === "number" ? String(o.identifier) : "";
  if (raw) return raw.slice(0, 200);
  const url = httpUrl(o.url, base);
  if (url && url !== base) return url.slice(0, 200);
  return stableId(author, date, body);
}

/** One schema.org Review object as an ImportedReview, or null when it has nothing to show. */
export function reviewFromJsonLd(o: Obj, base?: string): ImportedReview | null {
  const rating = isObj(o.reviewRating) ? toRating(o.reviewRating.ratingValue, o.reviewRating.bestRating ?? 5) : undefined;
  const text = cleanText(o.reviewBody ?? o.description ?? o.text);
  const headline = cleanLine(o.headline ?? o.name, 200);
  if (!text && !headline && rating === undefined) return null;
  const authorName = nameOf(o.author) ?? nameOf(o.creator) ?? "Anonymous";
  const rawDate = String(o.datePublished ?? o.dateCreated ?? o.dateModified ?? "");
  return {
    sourceReviewId: idOf(o, base, authorName, rawDate, text ?? headline ?? ""),
    authorName,
    authorTitle: isObj(o.author) ? cleanLine(o.author.jobTitle) : undefined,
    avatarUrl: isObj(o.author) ? imageOf(o.author.image) : undefined,
    rating,
    headline: headline && headline !== text ? headline : undefined,
    text,
    url: httpUrl(o.url, base),
    date: parseSourceDate(o.datePublished ?? o.dateCreated),
    language: typeof o.inLanguage === "string" ? o.inLanguage.slice(0, 16) : undefined,
  };
}

/** Reviews in parsed JSON-LD blocks: Review nodes anywhere, plus every `review` of a Product, Organization… */
export function reviewsFromJsonLd(blocks: unknown[], base?: string): ImportedReview[] {
  const found: Obj[] = [];
  const seen = new Set<Obj>();
  for (const o of walk(blocks)) {
    const t = types(o);
    if ((t.includes("review") || t.includes("userreview") || t.includes("criticreview")) && !seen.has(o)) {
      seen.add(o);
      found.push(o);
    }
  }
  const out: ImportedReview[] = [];
  const ids = new Set<string>();
  for (const o of found) {
    const r = reviewFromJsonLd(o, base);
    if (r && !ids.has(r.sourceReviewId)) {
      ids.add(r.sourceReviewId);
      out.push(r);
    }
  }
  return out;
}

function propValue(el: Element, base?: string): string {
  const v = attr(el, "content") ?? attr(el, "datetime");
  if (v !== undefined) return v;
  if (el.name === "a" || el.name === "link") {
    const href = httpUrl(attr(el, "href"), base);
    if (href) return href;
  }
  return textOf(el);
}

/** A name-like value: an attribute's content, or the element's text (never a link's href). */
function textValue(el: Element): string {
  return attr(el, "content") ?? textOf(el);
}

/** The `name` properties of this item, not of items nested in it (the author's own name, say). */
function props(scope: Element, name: string): Element[] {
  return findAll(scope.children, (e) => {
    if (!(attr(e, "itemprop") ?? "").split(/\s+/).includes(name)) return false;
    for (let p = e.parent; p && p !== scope; p = p.parent) {
      if ((p as Element).attribs && attr(p as Element, "itemscope") !== undefined) return false;
    }
    return true;
  });
}

/** Reviews marked up with microdata (itemtype=".../Review"). */
export function reviewsFromMicrodata(doc: Document, base?: string): ImportedReview[] {
  const out: ImportedReview[] = [];
  const ids = new Set<string>();
  for (const el of findAll(doc, (e) => /schema\.org\/(User)?Review$/i.test(attr(e, "itemtype") ?? ""))) {
    const first = (name: string) => props(el, name)[0];
    const authorEl = first("author");
    const authorNameEl = authorEl ? (props(authorEl, "name")[0] ?? authorEl) : undefined;
    const authorName = cleanLine(authorNameEl ? textValue(authorNameEl) : undefined) ?? "Anonymous";
    const ratingEl = first("ratingValue");
    const bestEl = first("bestRating");
    const rating = ratingEl ? toRating(propValue(ratingEl), bestEl ? propValue(bestEl) : 5) : undefined;
    const bodyEl = first("reviewBody") ?? first("description");
    const text = bodyEl ? cleanText(textOf(bodyEl)) : undefined;
    const headEl = first("headline") ?? first("name");
    const headline = headEl && headEl !== authorEl ? cleanLine(textValue(headEl), 200) : undefined;
    const dateEl = first("datePublished");
    const rawDate = dateEl ? propValue(dateEl) : "";
    if (!text && !headline && rating === undefined) continue;
    const urlEl = first("url");
    const id = attr(el, "itemid") ?? attr(el, "id") ?? stableId(authorName, rawDate, text ?? headline ?? "");
    if (ids.has(id)) continue;
    ids.add(id);
    out.push({
      sourceReviewId: id.slice(0, 200),
      authorName,
      rating,
      headline: headline && headline !== text ? headline : undefined,
      text,
      url: urlEl ? httpUrl(propValue(urlEl, base), base) : undefined,
      date: parseSourceDate(rawDate),
    });
  }
  return out;
}

/** JSON-LD reviews on a page, or microdata ones when it has none. */
export function reviewsFromPage(html: string, base?: string): ImportedReview[] {
  const doc = parseDom(html);
  const fromLd = reviewsFromJsonLd(jsonLdBlocks(doc), base);
  return fromLd.length ? fromLd : reviewsFromMicrodata(doc, base);
}
