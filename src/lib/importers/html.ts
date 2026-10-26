import crypto from "node:crypto";
import { DomUtils, parseDocument } from "htmlparser2";
import type { AnyNode, Document, Element } from "domhandler";
import type { DatePrecision } from "@/db/schema";

/**
 * Helpers for reading other sites' pages and answers. Everything here is
 * defensive: pages change without notice, so a missing or odd value gives
 * undefined rather than an error, and text always comes out as plain text
 * (markup stripped, entities decoded), never HTML.
 */

export type { Element };

export function parseDom(html: string): Document {
  return parseDocument(html, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
}

export function attr(el: Element, name: string): string | undefined {
  const v = el.attribs?.[name];
  return v === undefined ? undefined : v;
}

export function findAll(root: AnyNode | AnyNode[], test: (el: Element) => boolean): Element[] {
  return DomUtils.findAll(test, Array.isArray(root) ? root : [root]);
}

export function findOne(root: AnyNode | AnyNode[], test: (el: Element) => boolean): Element | null {
  return DomUtils.findOne(test, Array.isArray(root) ? root : [root], true);
}

/** Elements whose class list has `name`. */
export const hasClass = (name: string) => (el: Element) => (attr(el, "class") ?? "").split(/\s+/).includes(name);

/** Visible text of a node: scripts and styles dropped, whitespace tidied, paragraphs kept apart. */
export function textOf(node: AnyNode | AnyNode[] | null | undefined): string {
  if (!node) return "";
  const parts: string[] = [];
  const BLOCK = new Set(["p", "div", "br", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "tr"]);
  const walk = (n: AnyNode) => {
    if (n.type === "text") parts.push((n as unknown as { data: string }).data);
    else if (n.type === "tag") {
      const el = n as Element;
      if (el.name === "br") {
        parts.push("\n");
        return;
      }
      const block = BLOCK.has(el.name);
      if (block) parts.push("\n");
      for (const c of el.children) walk(c);
      if (block) parts.push("\n");
    } else if (n.type === "root") for (const c of (n as Document).children) walk(c);
    // script, style and comments are skipped.
  };
  for (const n of Array.isArray(node) ? node : [node]) walk(n);
  return tidy(parts.join(""));
}

/** Collapses runs of spaces, keeps single blank lines between paragraphs. */
export function tidy(s: string) {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v  ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Plain text from a value that may hold markup or entities ("Great&nbsp;app<br>Thanks").
 * Caps the length; empty gives undefined.
 */
export function cleanText(raw: unknown, max = 5000): string | undefined {
  if (typeof raw !== "string" && typeof raw !== "number") return undefined;
  const s = String(raw);
  const text = /[<&]/.test(s) ? textOf(parseDom(s).children) : tidy(s);
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A short single-line value (a name, a title). */
export function cleanLine(raw: unknown, max = 120): string | undefined {
  const t = cleanText(raw, max * 2)?.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** An absolute http(s) URL, or undefined. Relative URLs resolve against `base`. */
export function httpUrl(raw: unknown, base?: string): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const u = base ? new URL(raw.trim(), base) : new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    if (u.username || u.password) return undefined;
    return u.toString().slice(0, 2000);
  } catch {
    return undefined;
  }
}

/** A rating on any scale ("4.5", 9 of 10) as 1–5 whole stars, or undefined. */
export function toRating(raw: unknown, best: unknown = 5): number | undefined {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(",", ".")) : NaN;
  let b = typeof best === "number" ? best : Number(best);
  if (!Number.isFinite(b) || b <= 0) b = 5;
  if (!Number.isFinite(n) || n <= 0 || n > b) return undefined;
  const r = Math.max(1, Math.round(b === 5 ? n : (n / b) * 5));
  return r <= 5 ? r : undefined;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function sane(t: number) {
  return Number.isFinite(t) && t > Date.UTC(1990, 0, 1) && t < Date.now() + 86_400_000;
}

/**
 * A review's date and how exact it is (IMP-05). "2026-10", "Oct 2026" and
 * "October 2026" are month-only and stored as the 1st at 00:00 UTC with
 * precision "month"; "2026" is a year; anything Date can read is a day.
 * Epoch numbers (seconds or milliseconds) are days. Unreadable gives undefined.
 */
export function parseSourceDate(raw: unknown): { value: Date; precision: DatePrecision } | undefined {
  if (raw instanceof Date) return sane(raw.getTime()) ? { value: raw, precision: "day" } : undefined;
  if (typeof raw === "number") {
    const ms = raw < 1e11 ? raw * 1000 : raw;
    return sane(ms) ? { value: new Date(ms), precision: "day" } : undefined;
  }
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  if (/^\d{10,13}$/.test(s)) return parseSourceDate(Number(s));
  let m = /^(\d{4})$/.exec(s);
  if (m) {
    const t = Date.UTC(Number(m[1]), 0, 1);
    return sane(t) ? { value: new Date(t), precision: "year" } : undefined;
  }
  m = /^(\d{4})[-/.](\d{1,2})$/.exec(s);
  if (m) {
    const month = Number(m[2]);
    const t = Date.UTC(Number(m[1]), month - 1, 1);
    return month >= 1 && month <= 12 && sane(t) ? { value: new Date(t), precision: "month" } : undefined;
  }
  m = /^([a-z]{3,9})\.?,?\s+(\d{4})$/i.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    const t = Date.UTC(Number(m[2]), month, 1);
    return month >= 0 && sane(t) ? { value: new Date(t), precision: "month" } : undefined;
  }
  // A bare date is midnight UTC, so it stays on its day in every time zone's display.
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const t = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Date.parse(s);
  return sane(t) ? { value: new Date(t), precision: "day" } : undefined;
}

/** A stable id for sources that give none: the same review always hashes the same. */
export function stableId(...parts: (string | number | undefined | null)[]) {
  return `h_${crypto.createHash("sha256").update(parts.map((p) => String(p ?? "")).join("␟")).digest("hex").slice(0, 24)}`;
}

/** Every JSON-LD block on a page, parsed; broken blocks are skipped. */
export function jsonLdBlocks(html: string | Document): unknown[] {
  const doc = typeof html === "string" ? parseDom(html) : html;
  const out: unknown[] = [];
  for (const el of findAll(doc, (e) => e.name === "script" && /ld\+json/i.test(attr(e, "type") ?? ""))) {
    const raw = DomUtils.textContent(el).trim().replace(/^<!--|-->$/g, "").replace(/^\/\/<!\[CDATA\[|\/\/\]\]>$/g, "");
    const parsed = parseJson(raw);
    if (parsed !== undefined) out.push(parsed);
  }
  return out;
}

/** The JSON in a <script id="…"> (e.g. __NEXT_DATA__), or undefined. */
export function scriptJson(html: string | Document, id: string): unknown {
  const doc = typeof html === "string" ? parseDom(html) : html;
  const el = findOne(doc, (e) => e.name === "script" && attr(e, "id") === id);
  return el ? parseJson(DomUtils.textContent(el).trim()) : undefined;
}

export function parseJson(raw: string): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** A page that a bot wall answered instead of the site (status or tell-tale markers). */
export function looksBlocked(status: number, text: string) {
  if (status === 401 || status === 403 || status === 429 || status === 503) return true;
  // A real page may load a captcha script for its own forms; a challenge page is small.
  if (status >= 200 && status < 300 && text.length < 30_000) {
    return /captcha|cf-chl-|challenge-platform|px-captcha|datadome|access denied|are you a robot|verify you are human/i.test(text.slice(0, 50_000));
  }
  return false;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** First present value among `keys` (a dotted path reads nested objects: "author.name"). */
export function pick(o: Obj, ...keys: string[]): unknown {
  for (const key of keys) {
    let cur: unknown = o;
    for (const part of key.split(".")) cur = isObj(cur) ? cur[part] : undefined;
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return undefined;
}

/**
 * Walks any JSON (a page's embedded data, an API answer) and returns the
 * objects that look like testimonials: a name-ish key and a text-ish or
 * video key. Used where a source's exact shape isn't documented, so small
 * renames on their side don't break the import.
 */
export function findReviewLike(json: unknown, max = 5000): Obj[] {
  const out: Obj[] = [];
  const seen = new Set<unknown>();
  const NAME = ["name", "customer_name", "customerName", "author_name", "authorName", "full_name", "fullName", "reviewer", "user_name", "userName"];
  const TEXT = ["text", "testimonial", "message", "content", "body", "review", "reviewBody", "quote", "feedback"];
  const VIDEO = ["video_url", "videoUrl", "video"];
  const walk = (v: unknown, depth: number) => {
    if (out.length >= max || depth > 12 || !v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    const o = v as Obj;
    const hasName = NAME.some((k) => typeof o[k] === "string" && (o[k] as string).trim()) || isObj(o.author) || isObj(o.customer) || isObj(o.user);
    const hasBody = TEXT.some((k) => typeof o[k] === "string" && (o[k] as string).trim().length > 1) || VIDEO.some((k) => typeof o[k] === "string" || isObj(o[k]));
    if (hasName && hasBody) {
      out.push(o);
      return;
    }
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  walk(json, 0);
  return out;
}

/** Text from an uploaded file: UTF-8, or UTF-16 when it starts with a byte-order mark (Play Console exports do). */
export function decodeUpload(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
}
