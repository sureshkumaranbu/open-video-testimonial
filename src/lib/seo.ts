import type { SeoSchemaType } from "@/db/schema";
import type { FeedItem } from "./widget-config";

/**
 * Review rich snippets (SEO-01..03): schema.org data for walls, the legacy
 * wall, and the owner's own pages. Pure functions, so pages, routes and
 * tests build the same JSON. Search engines decide whether to show stars;
 * this only makes the data valid and safe to embed. Client-safe (no Node
 * APIs, type-only schema imports), so the SEO page uses the same labels.
 */

export type { SeoSchemaType };

/** Same order as SEO_SCHEMA_TYPES in src/db/schema.ts (a test keeps them equal). */
export const SEO_SCHEMA_TYPES = ["Product", "Organization", "LocalBusiness", "SoftwareApplication", "Course"] as const satisfies readonly SeoSchemaType[];

/** Which testimonials a snippet describes. */
export const SCOPE_MODES = ["all", "tags", "form"] as const;
export type ScopeMode = (typeof SCOPE_MODES)[number];

/** Google reads at most a handful; more only makes the page heavier. */
export const SEO_MAX_REVIEWS = 10;
/** Below this, rich results are unlikely (SEO-02 guidance). */
export const SEO_MIN_REVIEWS = 5;

export const SCHEMA_TYPE_LABELS: Record<SeoSchemaType, string> = {
  Product: "Product",
  Organization: "Organisation",
  LocalBusiness: "Local business",
  SoftwareApplication: "Software or app",
  Course: "Course",
};

/** Rated public testimonials only: what schema.org calls the rating count, and their average. */
export type RatingSummary = { count: number; average: number | null };

export type ReviewJsonLdInput = {
  type: SeoSchemaType;
  /** The thing being reviewed (a product, the business, the course…). */
  name: string;
  url?: string | null;
  description?: string | null;
  image?: string | null;
  items: FeedItem[];
  aggregate: RatingSummary;
};

const httpUrl = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : undefined);

/** What a review says: its text, else a video's transcript. */
function body(t: FeedItem): string | null {
  const text = t.text?.trim() || t.video?.transcript?.trim();
  return text || null;
}

/** One schema.org Review for a public testimonial (no private field can reach it: FeedItem is a whitelist). */
export function reviewEntry(t: FeedItem) {
  return {
    "@type": "Review",
    author: { "@type": "Person", name: t.name },
    ...(t.extra.headline ? { name: t.extra.headline } : {}),
    reviewBody: body(t),
    datePublished: t.extra.date.slice(0, 10),
    ...(t.rating ? { reviewRating: { "@type": "Rating", ratingValue: t.rating, bestRating: 5, worstRating: 1 } } : {}),
  };
}

/**
 * The JSON-LD object: the reviewed thing, at most 10 reviews with text, and
 * an AggregateRating only once at least one review has a rating.
 */
export function reviewJsonLd(o: ReviewJsonLdInput) {
  const type = (SEO_SCHEMA_TYPES as readonly string[]).includes(o.type) ? o.type : "Product";
  const reviews = o.items.filter((t) => body(t)).slice(0, SEO_MAX_REVIEWS).map(reviewEntry);
  const agg = o.aggregate;
  return {
    "@context": "https://schema.org",
    "@type": type,
    name: o.name.trim() || "Reviews",
    ...(httpUrl(o.url) ? { url: httpUrl(o.url) } : {}),
    ...(o.description?.trim() ? { description: o.description.trim() } : {}),
    ...(httpUrl(o.image) ? { image: httpUrl(o.image) } : {}),
    ...(agg.count >= 1 && agg.average != null
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: Math.round(agg.average * 10) / 10,
            ratingCount: agg.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    ...(reviews.length ? { review: reviews } : {}),
  };
}

/**
 * JSON text that's safe inside an HTML <script> block and a JS string:
 * "<", ">" and "&" become \u escapes (so "</script>" and "<!--" can't end
 * or change the block), as do U+2028 and U+2029.
 */
export function jsonLdText(obj: unknown, indent?: number): string {
  return JSON.stringify(obj, null, indent)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** A complete <script type="application/ld+json"> block (the "static" snippet). */
export function jsonLdScript(obj: unknown, o: { indent?: number } = {}): string {
  return `<script type="application/ld+json">${o.indent ? "\n" : ""}${jsonLdText(obj, o.indent)}${o.indent ? "\n" : ""}</script>`;
}

/**
 * The "dynamic" snippet's script: adds the JSON-LD to document.head once,
 * even when the tag is pasted twice. The data is a JS string literal of the
 * escaped JSON, so nothing in a review can break out of it.
 */
export function snippetJs(id: string, obj: unknown): string {
  const marker = JSON.stringify(id);
  return (
    `/* Plaudit review data ${id.replace(/[^a-z0-9_]/gi, "")} */\n` +
    `(function(d){var m=${marker};var q=d.querySelectorAll("script[data-plaudit-schema]");` +
    `for(var i=0;i<q.length;i++)if(q[i].getAttribute("data-plaudit-schema")===m)return;` +
    `var s=d.createElement("script");s.type="application/ld+json";s.setAttribute("data-plaudit-schema",m);` +
    `s.text=${JSON.stringify(jsonLdText(obj))};(d.head||d.documentElement).appendChild(s);})(document);\n`
  );
}

export type Guidance = { level: "warn" | "info"; text: string };

const TYPE_NOTES: Partial<Record<SeoSchemaType, string>> = {
  Organization:
    "Search engines rarely show stars for reviews a business publishes about itself. Product, software or course pages are a better fit.",
  LocalBusiness:
    "Search engines rarely show stars for reviews a business publishes about itself, and a local business also needs its address in your own markup.",
  SoftwareApplication: "Software results also expect a price (an “offers” entry) in your own markup.",
  Course: "Course results also expect a description and a provider in your own markup.",
};

/** SEO-02: what to know before pasting the snippet. `reviews` counts public reviews with text in scope. */
export function seoGuidance(o: { reviews: number; rated: number; type: SeoSchemaType }): Guidance[] {
  const out: Guidance[] = [];
  if (o.reviews < SEO_MIN_REVIEWS)
    out.push({
      level: "warn",
      text: `Only ${o.reviews} ${o.reviews === 1 ? "review" : "reviews"} so far. Rich results usually need at least ${SEO_MIN_REVIEWS}; collect a few more first.`,
    });
  if (o.rated === 0) out.push({ level: "warn", text: "None of these reviews has a star rating yet, so there's no average to show." });
  const note = TYPE_NOTES[o.type];
  if (note) out.push({ level: "info", text: note });
  out.push({ level: "info", text: "Put it on the page about the thing being reviewed (a product or pricing page), not on your home page." });
  out.push({ level: "info", text: "Valid data makes stars possible, not certain: the search engine decides whether to show them." });
  return out;
}
