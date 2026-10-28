import type { Document } from "domhandler";
import { z } from "zod";
import { env } from "./env";
import { attr, cleanLine, cleanText, findAll, findOne, parseDom, stableId, textOf } from "./importers/html";
import { type SiteBrand, usableBrandColor } from "./importers/sources/website";
import type { ImportedReview } from "./importers/types";
import { ProviderError, providerJson } from "./provider-fetch";

/**
 * The brand scan's optional AI step (ONB-02/03, L10), with the owner's own
 * OpenAI-compatible /chat/completions endpoint (BRAND_AI_API_URL,
 * BRAND_AI_API_KEY, BRAND_AI_MODEL). Off until a model is set. It gets the
 * home page's title, meta tags, the colours in its inline styles and its
 * visible text (capped), never the raw HTML, and may suggest the site name,
 * the primary colour and testimonials. Everything it says is checked before
 * use: the colour must be one the page uses, and a testimonial's quote and
 * name must both be on the page, so nothing is made up. Any provider error,
 * timeout or odd answer means no suggestion; the heuristics stand alone.
 */

/** Characters of visible page text sent to the provider. */
const MAX_TEXT = 12_000;
/** Colours from the page's styles listed for the provider, most used first. */
const MAX_COLORS = 12;
const MAX_ANSWER_BYTES = 256 * 1024;
const MAX_ITEMS = 20;

export function brandAiEnabled() {
  return Boolean(env.brandAiModel && env.brandAiApiUrl);
}

const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const long = (hex: string) => (hex.length === 4 ? `#${hex.slice(1).split("").map((d) => d + d).join("")}` : hex).toLowerCase();

/** Hex colours in the page's own <style> blocks and style attributes (no stylesheet is fetched), most used first. */
export function pageColors(doc: Document): string[] {
  const counts = new Map<string, number>();
  const add = (css: string) => {
    for (const m of css.matchAll(HEX)) {
      const c = long(m[0]);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  };
  for (const el of findAll(doc, (e) => e.name === "style")) add(el.children.map((c) => (c as unknown as { data?: string }).data ?? "").join(""));
  for (const el of findAll(doc, (e) => Boolean(attr(e, "style")))) add(attr(el, "style") ?? "");
  for (const el of findAll(doc, (e) => e.name === "meta" && (attr(e, "name") ?? "").toLowerCase() === "theme-color")) add(attr(el, "content") ?? "");
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/** What the provider reads: a few head fields, the page's colours and its visible text, capped. */
export function pageDigest(html: string, url: string): { prompt: string; text: string; colors: string[] } {
  const doc = parseDom(html);
  const meta = (key: string) => {
    const el = findOne(doc, (e) => e.name === "meta" && (attr(e, "property") ?? attr(e, "name") ?? "").toLowerCase() === key);
    return cleanLine(el ? attr(el, "content") : undefined, 300);
  };
  const title = findOne(doc, (e) => e.name === "title");
  const body = findOne(doc, (e) => e.name === "body");
  const text = textOf(body ?? doc).slice(0, MAX_TEXT);
  const colors = pageColors(doc);
  const lines = [
    `Address: ${url}`,
    `Title: ${cleanLine(title ? textOf(title) : undefined, 300) ?? ""}`,
    `og:site_name: ${meta("og:site_name") ?? ""}`,
    `Description: ${meta("description") ?? meta("og:description") ?? ""}`,
    `Colours used on the page: ${colors.slice(0, MAX_COLORS).join(", ") || "none"}`,
    "",
    "Visible text:",
    text,
  ];
  return { prompt: lines.join("\n"), text, colors };
}

const optionalLine = (max: number) => z.string().trim().min(1).max(max).nullish().catch(undefined);

/** The answer we ask for. Each part is checked on its own, so one bad field doesn't sink the rest. */
const answerSchema = z.object({
  siteName: optionalLine(80),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i)
    .nullish()
    .catch(undefined),
  testimonials: z
    .array(
      z
        .object({
          authorName: z.string().trim().min(2).max(80),
          authorTitle: optionalLine(120),
          authorCompany: optionalLine(120),
          text: z.string().trim().min(20).max(2000),
          rating: z.number().int().min(1).max(5).nullish().catch(undefined),
        })
        .nullable()
        .catch(null),
    )
    .max(50)
    .nullish()
    .catch(undefined),
});

export type BrandSuggestion = { name?: string; color?: string; testimonials: ImportedReview[] };

/** Lower case letters and digits only, so quotes match whatever punctuation and spacing the page used. */
const plain = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const SYSTEM = [
  "You read the text of a business's home page and answer with only a JSON object, no prose:",
  '{"siteName": string|null, "primaryColor": "#rrggbb"|null, "testimonials": [{"authorName": string, "authorTitle": string|null, "authorCompany": string|null, "text": string, "rating": 1-5|null}]}',
  "siteName is the business or product name. primaryColor is the brand's main colour, chosen only from the page's listed colours, never white, black or grey.",
  "testimonials are quotes from customers that appear on the page, copied word for word with the person's name as written. Leave out anything that isn't clearly a customer's testimonial. Use an empty list when there are none.",
].join("\n");

/**
 * Asks the provider about a page. Null when it's off, fails, times out or
 * answers with something unusable: the caller then keeps the heuristics.
 */
export async function suggestBrand(html: string, url: string, o: { timeoutMs: number }): Promise<BrandSuggestion | null> {
  if (!brandAiEnabled() || o.timeoutMs < 1000) return null;
  const digest = pageDigest(html, url);
  let json: unknown;
  try {
    json = await providerJson(
      `${env.brandAiApiUrl}/chat/completions`,
      {
        model: env.brandAiModel,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: digest.prompt },
        ],
      },
      { headers: env.brandAiApiKey ? { Authorization: `Bearer ${env.brandAiApiKey}` } : {}, timeoutMs: o.timeoutMs, maxBytes: MAX_ANSWER_BYTES },
    );
  } catch (err) {
    if (err instanceof ProviderError) console.warn(`[onboarding] brand AI step skipped: ${err.message}`);
    return null;
  }
  const content = (json as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) return null;
  const a = parsed.data;

  const page = plain(digest.text);
  const onPage = (s: string) => {
    const p = plain(s);
    return p.length > 0 && page.includes(p);
  };
  const color = a.primaryColor ? long(a.primaryColor) : undefined;
  const testimonials: ImportedReview[] = [];
  for (const t of a.testimonials ?? []) {
    if (!t || testimonials.length >= MAX_ITEMS) continue;
    const text = cleanText(t.text.replace(/^["“”'‘]+|["“”'’]+$/g, ""), 2000);
    const name = cleanLine(t.authorName, 80);
    // Only what's really on the page: a quote and a name the provider made up are dropped.
    if (!text || !name || !onPage(text) || !onPage(name)) continue;
    testimonials.push({
      sourceReviewId: stableId("website", name, text),
      authorName: name,
      authorTitle: t.authorTitle && onPage(t.authorTitle) ? t.authorTitle : undefined,
      authorCompany: t.authorCompany && onPage(t.authorCompany) ? t.authorCompany : undefined,
      text,
      rating: t.rating ?? undefined,
    });
  }
  return {
    name: a.siteName ? cleanLine(a.siteName, 80) : undefined,
    // A colour the page doesn't use, or one that would make an invisible button, is ignored.
    color: color && digest.colors.includes(color) && usableBrandColor(color) ? color : undefined,
    testimonials,
  };
}

const key = (r: ImportedReview) => plain(r.text ?? r.headline ?? "").slice(0, 200);

/**
 * The heuristics first, the AI's suggestions filling the gaps: the page's own
 * site name and theme colour win, and suggested testimonials are added after
 * the ones found in the markup, once each.
 */
export function mergeSuggestion(brand: SiteBrand, items: ImportedReview[], ai: BrandSuggestion | null, max = 50): { brand: SiteBrand; items: ImportedReview[] } {
  if (!ai) return { brand, items };
  const seen = new Set(items.map(key));
  const added = ai.testimonials.filter((t) => {
    const k = key(t);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    brand: { ...brand, name: brand.name ?? ai.name, color: brand.color ?? ai.color },
    items: [...items, ...added].slice(0, max),
  };
}
