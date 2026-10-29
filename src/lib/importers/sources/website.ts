import type { Document, Element } from "domhandler";
import { z } from "zod";
import { attr, cleanLine, cleanText, findAll, findOne, httpUrl, jsonLdBlocks, parseDom, stableId, textOf } from "../html";
import { reviewsFromJsonLd, reviewsFromMicrodata } from "../jsonld-reviews";
import { type ImportCtx, type ImportedReview, type ImporterAdapter, ImporterInputError } from "../types";

/**
 * The onboarding wizard's "find testimonials on your site" (ONB-03): reads
 * the owner's own home page once and picks out testimonials from schema.org
 * reviews (JSON-LD or microdata) and from simple markup: a quote (a
 * blockquote, figure or an element whose class says testimonial, review or
 * quote) with a name close by. No LLM. It respects robots.txt and fetches
 * through net-guard (no private addresses), 5 MB and 10 seconds at most.
 */

const PAGE_MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_ITEMS = 50;
const USER_AGENT = "Plaudit";

const input = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Enter your website")
    .max(500)
    .transform((raw, ctx) => {
      const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      try {
        const u = new URL(withScheme);
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
        u.hash = "";
        return u.toString();
      } catch {
        ctx.addIssue({ code: "custom", message: "That doesn't look like a web address" });
        return z.NEVER;
      }
    }),
});

// ------------------------------------------------------------- robots.txt

/**
 * Whether robots.txt lets `agent` read `path`: the group naming the agent,
 * else the `*` group; the longest matching Allow/Disallow wins (Allow on a
 * tie). `*` and `$` wildcards are understood.
 */
export function robotsAllows(robots: string, path: string, agent = USER_AGENT): boolean {
  type Group = { agents: string[]; rules: { allow: boolean; pattern: string }[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      lastWasAgent = false;
      if (value || key === "allow") current.rules.push({ allow: key === "allow", pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  const me = agent.toLowerCase();
  const group = groups.find((g) => g.agents.some((a) => a !== "*" && me.includes(a))) ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  const toRe = (p: string) => new RegExp(`^${p.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$|\$$/, "$")}`);
  let best: { allow: boolean; len: number } | null = null;
  for (const r of group.rules) {
    if (!r.pattern) continue;
    if (!toRe(r.pattern).test(path)) continue;
    const len = r.pattern.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
  }
  return best ? best.allow : true;
}

// --------------------------------------------------------------- the page

const CANDIDATE = /(^|[\s_-])(testimonials?|reviews?|quotes?|kudos|endorsements?)([\s_-]|$)/i;
const NAME_HINT = /(^|[\s_-])(name|author|cite|person)([\s_-]|$)/i;
const ROLE_HINT = /(^|[\s_-])(title|role|position|job|company|org|business)([\s_-]|$)/i;
const SKIP = new Set(["script", "style", "noscript", "template", "nav", "header", "footer", "form", "svg"]);

/** Class and id words, without utility-class arbitrary values like `font-[family-name:…]` that would read as "name". */
const classOf = (el: Element) => `${attr(el, "class") ?? ""} ${attr(el, "id") ?? ""}`.replace(/\[[^\]]*\]/g, "");

function insideSkipped(el: Element): boolean {
  for (let p = el.parent as Element | null; p && p.type === "tag"; p = p.parent as Element | null) {
    if (SKIP.has(p.name)) return true;
  }
  return false;
}

/** Classes that mark a part of a testimonial card ("testimonial-text", "review-author"), not a card. */
const PART = /(^|[\s_-])(text|body|content|author|name|title|role|company|meta|rating|stars?|avatar|photo|image|img|date)([\s_-]|$)/i;

function isCandidate(el: Element) {
  if (el.name === "blockquote" || el.name === "figure" || el.name === "q") return true;
  if (!["div", "li", "article", "section", "aside"].includes(el.name)) return false;
  const cls = classOf(el);
  return CANDIDATE.test(cls) && !PART.test(cls);
}

/** The quote part of a candidate: its blockquote or q, else its paragraphs, without the name lines. */
function quoteOf(el: Element, skip: Element[]): string {
  const inner = el.name === "blockquote" || el.name === "q" ? el : findOne(el.children, (e) => e.name === "blockquote" || e.name === "q");
  const keep = (n: unknown) => !skip.some((s) => s === n || isAncestor(s, n as Element));
  if (inner) return textOf(inner.children.filter(keep));
  const paras = findAll(el.children, (e) => e.name === "p" && keep(e));
  if (paras.length) return paras.map((p) => textOf(p)).join("\n\n");
  return textOf(el.children.filter(keep));
}

function isAncestor(a: Element, b: Element) {
  for (let p = b.parent as Element | null; p; p = p.parent as Element | null) if (p === a) return true;
  return false;
}

function splitRole(s: string) {
  const [first, ...rest] = s.split(/\s*[,·|–—]\s*|\n/);
  return { name: first, role: rest.join(", ") || undefined };
}

/** The visible text lines of a small attribution block, leaving out avatar initials and hidden parts. */
function shortLines(el: Element): string[] {
  const out: string[] = [];
  const walk = (e: Element) => {
    if (attr(e, "aria-hidden") === "true" || SKIP.has(e.name)) return;
    const kids = e.children.filter((c): c is Element => c.type === "tag");
    if (!kids.length) {
      const t = textOf(e).replace(/\s+/g, " ").trim();
      if (t.length > 1) out.push(t);
    } else kids.forEach(walk);
  };
  walk(el);
  return out.length > 4 ? [] : out;
}

/** A person's name, not a sentence: up to 6 words, starts with a capital (or a letter from a script without case, like Tamil), no closing punctuation. */
const looksLikeName = (s: string) => s.length <= 60 && s.split(/\s+/).length <= 6 && /^[\p{Lu}\p{Lo}]/u.test(s) && !/[.!?:।]$/.test(s);

/** The name (and title) close to a quote: a class saying name/author, cite, figcaption, footer, or a "— Name" line after it. */
function attribution(el: Element): { name?: string; role?: string; used: Element[] } {
  const used: Element[] = [];
  const roleEl = findOne(el.children, (e) => ROLE_HINT.test(classOf(e)) && !NAME_HINT.test(classOf(e)));
  if (roleEl) used.push(roleEl);
  const nameEl =
    findOne(el.children, (e) => NAME_HINT.test(classOf(e))) ??
    findOne(el.children, (e) => e.name === "cite") ??
    findOne(el.children, (e) => e.name === "figcaption") ??
    findOne(el.children, (e) => e.name === "footer");
  let name: string | undefined;
  let role = roleEl ? textOf(roleEl) : undefined;
  if (nameEl) {
    used.push(nameEl);
    const strong = findOne(nameEl.children, (e) => e.name === "strong" || e.name === "b");
    const all = textOf(nameEl).replace(/^[-–—~\s]+/, "");
    if (strong) {
      name = textOf(strong);
      role = role ?? (all.replace(name, "").replace(/^[\s,·|–—-]+|[\s,·|–—-]+$/g, "") || undefined);
    } else {
      const split = splitRole(all);
      name = split.name;
      role = role ?? split.role;
    }
  } else if (el.name === "blockquote") {
    // <blockquote>…</blockquote><p>— Ada, CTO</p>
    let next = el.next;
    while (next && next.type !== "tag") next = next.next;
    const line = next ? textOf(next as Element) : "";
    if (/^\s*[-–—~]/.test(line)) {
      const split = splitRole(line.replace(/^[-–—~\s]+/, ""));
      name = split.name;
      role = role ?? split.role;
    } else if (next && next.type === "tag" && ["div", "span", "footer", "figcaption"].includes((next as Element).name)) {
      // <blockquote>…</blockquote><div><span aria-hidden>S</span><div><p>Sarah Chen</p><p>Student</p></div></div>
      const lines = shortLines(next as Element);
      if (lines.length >= 1 && lines.length <= 3 && looksLikeName(lines[0])) {
        name = lines[0];
        role = role ?? lines[1];
        used.push(next as Element);
      }
    }
  }
  return { name: cleanLine(name, 80), role: cleanLine(role, 120), used };
}

const QUOTE_TAGS = new Set(["blockquote", "q"]);

/** Testimonials from the page's own markup (not schema.org): quote blocks with a name nearby. */
export function testimonialsFromMarkup(doc: Document): ImportedReview[] {
  const candidates = findAll(doc, (e) => isCandidate(e) && !insideSkipped(e));
  const cards = candidates.filter((c) => !QUOTE_TAGS.has(c.name));
  // A "testimonials" section holding several cards isn't one testimonial: keep the innermost cards,
  // and quotes that no kept card holds.
  // A card holding several quotes (a whole "testimonials" section) is a container, not a card.
  const quoteCount = (c: Element) => candidates.filter((q) => QUOTE_TAGS.has(q.name) && isAncestor(c, q)).length;
  const keptCards = cards.filter((c) => !cards.some((o) => o !== c && isAncestor(c, o)) && quoteCount(c) <= 1);
  const quotes = candidates.filter((c) => QUOTE_TAGS.has(c.name) && !keptCards.some((k) => isAncestor(k, c)));
  const out: ImportedReview[] = [];
  for (const el of [...keptCards, ...quotes]) {
    const { name, role, used } = attribution(el);
    if (!name) continue;
    const text = cleanText(quoteOf(el, used).replace(/^["“”'‘]+|["“”'’]+$/g, "").trim());
    if (!text || text.length < 20 || text.length > 2000 || text === name) continue;
    if (name.length < 2 || name.split(/\s+/).length > 6) continue;
    const ratingAttr = attr(el, "data-rating");
    const rating = ratingAttr && /^[1-5]$/.test(ratingAttr) ? Number(ratingAttr) : undefined;
    const [title, company] = (role ?? "").split(/\s*(?:,| at | @ )\s*/);
    out.push({
      sourceReviewId: stableId("website", name, text),
      authorName: name,
      authorTitle: title || undefined,
      authorCompany: company || undefined,
      text,
      rating,
    });
  }
  return out;
}

const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Everything found on one page: schema.org reviews first, then markup; the same quote is kept once. */
export function discoverFromHtml(html: string, base?: string): ImportedReview[] {
  const doc = parseDom(html);
  const all = [...reviewsFromJsonLd(jsonLdBlocks(doc), base), ...reviewsFromMicrodata(doc, base), ...testimonialsFromMarkup(doc)];
  const seen = new Set<string>();
  const out: ImportedReview[] = [];
  for (const r of all) {
    const key = norm(r.text ?? r.headline).slice(0, 200);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

// -------------------------------------------------------------- the brand

export type SiteBrand = { name?: string; description?: string; color?: string; logoUrl?: string };

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Whether a theme-color can stand in for a brand colour. Many sites set it to
 * white, black or a grey for the browser bar; as a button colour that would be
 * invisible or dull, so those are left for the default accent.
 */
export function usableBrandColor(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  return lightness > 0.12 && lightness < 0.85 && saturation > 0.2;
}

/** Site name and description, theme colour and a logo image (never SVG) from the page head and header. */
export function brandFromHtml(html: string, base: string): SiteBrand {
  const doc = parseDom(html);
  const meta = (pred: (e: Element) => boolean) => {
    const el = findOne(doc, (e) => e.name === "meta" && pred(e));
    return el ? attr(el, "content")?.trim() : undefined;
  };
  const prop = (p: string) => meta((e) => (attr(e, "property") ?? attr(e, "name") ?? "").toLowerCase() === p);
  const titleEl = findOne(doc, (e) => e.name === "title");
  const name = cleanLine(prop("og:site_name") ?? prop("application-name") ?? (titleEl ? textOf(titleEl).split(/\s[|–—-]\s/)[0] : undefined), 80);
  const description = cleanLine(prop("description") ?? prop("og:description"), 300);
  // A page can carry one theme-color per colour scheme: take the first that looks like a brand colour.
  const color = findAll(doc, (e) => e.name === "meta" && (attr(e, "name") ?? "").toLowerCase() === "theme-color")
    .map((e) => attr(e, "content")?.trim() ?? "")
    .map((c) => (/^#[0-9a-f]{3}$/i.test(c) ? `#${c.slice(1).split("").map((d) => d + d).join("")}` : c))
    .find((c) => HEX.test(c) && usableBrandColor(c));
  const notSvg = (u: string | undefined) => (u && !/\.svg(\?|#|$)/i.test(u) && !/^data:/i.test(u) ? u : undefined);
  const touch = findOne(doc, (e) => e.name === "link" && /apple-touch-icon/i.test(attr(e, "rel") ?? ""));
  const headerLogo = findOne(doc, (e) => e.name === "img" && /logo/i.test(`${attr(e, "class") ?? ""} ${attr(e, "alt") ?? ""} ${attr(e, "src") ?? ""} ${attr(e, "id") ?? ""}`));
  const logo = notSvg(touch ? attr(touch, "href") : undefined) ?? notSvg(headerLogo ? attr(headerLogo, "src") : undefined) ?? notSvg(prop("og:image"));
  return {
    name,
    description,
    color: color && HEX.test(color) ? color.toLowerCase() : undefined,
    logoUrl: logo ? httpUrl(logo, base) : undefined,
  };
}

// ------------------------------------------------------------ the adapter

export type SitePage = { html: string; url: string; brand: SiteBrand; items: ImportedReview[] };

/** Fetches the home page (after robots.txt says yes) and reads it. Throws ImporterInputError with a message for the owner. */
export async function readSite(rawUrl: string, ctx: Pick<ImportCtx, "fetchText">): Promise<SitePage> {
  const parsed = input.safeParse({ url: rawUrl });
  if (!parsed.success) throw new ImporterInputError(parsed.error.issues[0]?.message ?? "That doesn't look like a web address");
  const url = new URL(parsed.data.url);
  const robots = await ctx
    .fetchText(`${url.origin}/robots.txt`, { maxBytes: 512 * 1024, timeoutMs: TIMEOUT_MS, headers: { accept: "text/plain,*/*;q=0.5" } })
    .catch(() => null);
  if (robots && robots.status === 200 && !robotsAllows(robots.text, `${url.pathname}${url.search}`)) {
    throw new ImporterInputError("Your site's robots.txt asks automated visitors not to read that page, so we left it alone.");
  }
  const res = await ctx.fetchText(url.toString(), { maxBytes: PAGE_MAX_BYTES, timeoutMs: TIMEOUT_MS, headers: { "user-agent": `${USER_AGENT} (testimonial finder)` } });
  if (res.status >= 400) throw new ImporterInputError(`Your site answered ${res.status}. Check the address and try again.`);
  if (!/html|xml|^$/i.test(res.contentType)) throw new ImporterInputError("That address isn't a web page");
  return { html: res.text, url: res.finalUrl, brand: brandFromHtml(res.text, res.finalUrl), items: discoverFromHtml(res.text, res.finalUrl) };
}

export const website: ImporterAdapter = {
  id: "website",
  label: "Your website",
  platform: "website",
  kind: "platform",
  method: "page-parse",
  tosNotes: "Reads your own home page once. Only testimonials you choose are imported.",
  fields: [{ key: "url", label: "Your website", placeholder: "https://example.com", type: "url" }],
  input,
  async fetchPage(raw, _cursor, ctx) {
    const { url } = raw as z.infer<typeof input>;
    const page = await readSite(url, ctx);
    return { items: page.items, next: null, total: page.items.length };
  },
  parseHtml(html) {
    return discoverFromHtml(html);
  },
};
