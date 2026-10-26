import { z } from "zod";
import type { WidgetLayout, WidgetSelectionMode } from "@/db/schema";

/**
 * A saved widget's configuration (DISP-01..07): which testimonials it shows,
 * how it looks, the per-layout options, its wording, the form CTA and the
 * rating summary. Client-safe (zod only), so the studio checks a change with
 * the very schema the server stores it with. Every section has defaults, so
 * a widget saved by an older version (or a partial PATCH) still parses.
 */

// zod's JIT compiles with new Function, which the dashboard's CSP forbids.
if (typeof window !== "undefined") z.config({ jitless: true });

/** Same order as WIDGET_LAYOUTS in src/db/schema.ts (a test keeps them equal). */
export const LAYOUTS = ["grid", "list", "carousel", "slider", "marquee", "featured", "badge", "toast"] as const satisfies readonly WidgetLayout[];
export const SELECTION_MODES = ["auto", "manual"] as const satisfies readonly WidgetSelectionMode[];
export const FEED_SORTS = ["newest", "oldest", "rating", "manual", "random"] as const;
export const FEED_TYPES = ["any", "text", "video", "image"] as const;
export const WIDGET_THEMES = ["light", "dark", "auto"] as const;
export const DATE_MODES = ["absolute", "relative", "hidden"] as const;
export const TOAST_POSITIONS = ["bottom-left", "bottom-right", "top-left", "top-right"] as const;
export const PLACEMENTS = ["home", "landing", "pricing", "product", "checkout", "about", "other"] as const;

/** The most a widget ever shows; also the cap on manual picks and pins. */
export const MAX_ITEMS = 100;

/** Plain names for the studio's layout picker (our own wording). */
export const LAYOUT_LABELS: Record<WidgetLayout, { name: string; blurb: string }> = {
  grid: { name: "Masonry grid", blurb: "Columns of cards of any height" },
  list: { name: "List", blurb: "One column, easy to read" },
  carousel: { name: "Carousel", blurb: "One testimonial at a time" },
  slider: { name: "Multi-card slider", blurb: "Several cards that slide" },
  marquee: { name: "Marquee", blurb: "Rows that scroll on their own" },
  featured: { name: "Single featured", blurb: "One big quote" },
  badge: { name: "Rating badge", blurb: "Average stars and a count" },
  toast: { name: "Floating toast", blurb: "A small card in a corner" },
};

export const PLACEMENT_LABELS: Record<(typeof PLACEMENTS)[number], string> = {
  home: "Home page",
  landing: "Landing page",
  pricing: "Pricing page",
  product: "Product page",
  checkout: "Checkout or sign-up",
  about: "About page",
  other: "Somewhere else",
};

/** DISP-15: the layouts that tend to suit each kind of page, best first. */
export const RECOMMENDED_LAYOUTS: Record<(typeof PLACEMENTS)[number], WidgetLayout[]> = {
  home: ["marquee", "grid"],
  landing: ["slider", "marquee"],
  pricing: ["badge", "carousel"],
  product: ["featured", "list"],
  checkout: ["toast", "badge"],
  about: ["grid", "list"],
  other: ["grid", "carousel"],
};

export function placementHint(placement: string | null | undefined): { layouts: WidgetLayout[]; text: string } | null {
  if (!placement || !(placement in RECOMMENDED_LAYOUTS)) return null;
  const p = placement as (typeof PLACEMENTS)[number];
  const layouts = RECOMMENDED_LAYOUTS[p];
  const names = layouts.map((l) => LAYOUT_LABELS[l].name.toLowerCase());
  return { layouts, text: `Recommended for a ${PLACEMENT_LABELS[p].toLowerCase()}: ${names.join(" or ")}.` };
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour such as #e2463f");
/** "" means "the theme's own colour". */
const colour = z.union([hex, z.literal("")]).default("");
const id = z.string().min(1).max(64);
const keyword = z.string().trim().min(1).max(60);

/** DISP-02. Shared with walls (M5). */
export const publicFiltersSchema = z.object({
  tags: z.array(z.string().trim().toLowerCase().min(1).max(32)).max(20).default([]),
  tagMode: z.enum(["any", "all"]).default("any"),
  /** 0 = any rating (unrated ones too). */
  minRating: z.number().int().min(0).max(5).default(0),
  platforms: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  type: z.enum(FEED_TYPES).default("any"),
  include: z.array(keyword).max(20).default([]),
  exclude: z.array(keyword).max(20).default([]),
  language: z.string().trim().max(20).default(""),
  formId: z.string().max(64).default(""),
  max: z.number().int().min(1).max(MAX_ITEMS).default(30),
  sort: z.enum(FEED_SORTS).default("newest"),
});
export type PublicFilters = z.input<typeof publicFiltersSchema>;
export type ResolvedFilters = z.output<typeof publicFiltersSchema>;

export const selectionSchema = z.object({
  mode: z.enum(SELECTION_MODES).default("auto"),
  manualIds: z.array(id).max(MAX_ITEMS).default([]),
  pinnedIds: z.array(id).max(20).default([]),
});

/** Fonts a widget may use: ones the host already has, or self-hosted ones under /fonts. */
export const WIDGET_FONTS = [
  { id: "default", label: "Plaudit (serif quotes)", family: "", file: null },
  { id: "system", label: "System", family: "ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif", file: null },
  { id: "serif", label: "Classic serif", family: "'Iowan Old Style','Palatino Linotype',Georgia,serif", file: null },
  { id: "rounded", label: "Rounded", family: "ui-rounded,'SF Pro Rounded',system-ui,sans-serif", file: null },
  { id: "geist", label: "Geist", family: "'Plaudit Geist',system-ui,sans-serif", file: "/fonts/geist-latin.woff2" },
  { id: "geist-mono", label: "Geist Mono", family: "'Plaudit Geist Mono',ui-monospace,Menlo,monospace", file: "/fonts/geist-mono-latin.woff2" },
] as const;
export type WidgetFontId = (typeof WIDGET_FONTS)[number]["id"];
const FONT_IDS = WIDGET_FONTS.map((f) => f.id) as [WidgetFontId, ...WidgetFontId[]];

/** DISP-03. */
export const designSchema = z.object({
  theme: z.enum(WIDGET_THEMES).default("light"),
  font: z.enum(FONT_IDS).default("default"),
  /** Initials, quote marks and buttons; "" = the project's brand colour. */
  accent: colour,
  text: colour,
  /** The person's name. */
  titleColor: colour,
  /** Dates, job titles and other small print. */
  dateColor: colour,
  star: colour,
  card: colour,
  border: colour,
  /** Behind the whole widget; "" = transparent. */
  background: colour,
  radius: z.number().int().min(0).max(32).default(18),
  shadow: z.boolean().default(true),
  /** The gap between cards, in px. */
  spacing: z.number().int().min(0).max(48).default(20),
  /** 0 = as wide as the space it's in. */
  maxWidth: z.number().int().min(0).max(2400).default(0),
  showRating: z.boolean().default(true),
  /** A platform mark that links to the original review. */
  showSource: z.boolean().default(true),
  showAvatar: z.boolean().default(true),
  /** Job title and company under the name. */
  showTitle: z.boolean().default(true),
  showHeadline: z.boolean().default(true),
  date: z.enum(DATE_MODES).default("hidden"),
  showImages: z.boolean().default(true),
  showVideo: z.boolean().default(true),
  showHighlights: z.boolean().default(true),
  /** A "Verified" mark on testimonials that came in through a Plaudit form. */
  showVerified: z.boolean().default(false),
  /** Cut longer texts with a "Read more" button; 0 = never. */
  readMore: z.number().int().min(0).max(2000).default(0),
  /** "Ada Lovelace" shows as "Ada" (done on the server, so the surname never leaves it). */
  firstNameOnly: z.boolean().default(false),
});

/** DISP-04. Each layout reads the ones it needs. */
export const optionsSchema = z.object({
  /** Grid: the most columns on a wide screen. */
  columns: z.number().int().min(1).max(4).default(3),
  arrows: z.boolean().default(true),
  dots: z.boolean().default(true),
  autoplay: z.boolean().default(true),
  /** Seconds each slide shows while autoplaying. */
  delay: z.number().int().min(2).max(30).default(6),
  /** Slider: cards side by side on a wide screen. */
  perView: z.number().int().min(1).max(4).default(3),
  rows: z.number().int().min(1).max(3).default(1),
  /** Marquee: 1 (slow) to 10 (fast). */
  speed: z.number().int().min(1).max(10).default(4),
  direction: z.enum(["left", "right"]).default("left"),
  toastPosition: z.enum(TOAST_POSITIONS).default("bottom-left"),
  /** Seconds before the first toast. */
  toastDelay: z.number().int().min(0).max(120).default(4),
  /** Seconds each toast stays up. */
  toastDuration: z.number().int().min(3).max(60).default(7),
  toastHideOnMobile: z.boolean().default(true),
  /** Load images and videos only as they scroll into view. */
  lazy: z.boolean().default(true),
});

const label = (fallback: string) => z.string().trim().max(60).default(fallback).transform((v) => v || fallback);

/** DISP-05. The visitor-facing words; empty ones fall back to English. */
export const labelsSchema = z.object({
  readMore: label("Read more"),
  readLess: label("Read less"),
  reviews: label("reviews"),
  outOf: label("out of 5"),
  cta: label("Leave a testimonial"),
  empty: label("No testimonials yet."),
  verified: label("Verified"),
  transcript: label("Transcript"),
  previous: label("Previous"),
  next: label("Next"),
  dismiss: label("Dismiss"),
  pause: label("Pause"),
  play: label("Play"),
});

/** DISP-06. */
export const ctaSchema = z.object({
  enabled: z.boolean().default(false),
  /** link: opens the hosted form; popup: the form in a dialog over the page. */
  mode: z.enum(["link", "popup"]).default("link"),
});

/** DISP-07. */
export const aggregateSchema = z.object({
  show: z.boolean().default(false),
  /** all: every approved testimonial; filtered: only the ones this widget matches. */
  scope: z.enum(["all", "filtered"]).default("filtered"),
});

export const widgetConfigSchema = z.object({
  v: z.literal(1).default(1),
  layout: z.enum(LAYOUTS).default("grid"),
  selection: selectionSchema.default(selectionSchema.parse({})),
  filters: publicFiltersSchema.default(publicFiltersSchema.parse({})),
  design: designSchema.default(designSchema.parse({})),
  options: optionsSchema.default(optionsSchema.parse({})),
  labels: labelsSchema.default(labelsSchema.parse({})),
  cta: ctaSchema.default(ctaSchema.parse({})),
  aggregate: aggregateSchema.default(aggregateSchema.parse({})),
});
export type WidgetConfig = z.output<typeof widgetConfigSchema>;
export type WidgetConfigInput = z.input<typeof widgetConfigSchema>;
export type WidgetDesign = WidgetConfig["design"];
export type WidgetOptions = WidgetConfig["options"];
export type WidgetLabels = WidgetConfig["labels"];

/** Grid in the light theme is what a data-project embed looks like today. */
export function defaultWidgetConfig(layout: WidgetLayout = "grid"): WidgetConfig {
  return widgetConfigSchema.parse({ layout });
}

/** Parses each section on its own, so one unreadable part falls back to its defaults instead of the whole widget. */
export function parseConfigLenient(raw: Record<string, unknown>): WidgetConfig {
  const part = <S extends z.ZodType>(s: S, v: unknown): z.output<S> => {
    const r = s.safeParse(v ?? {});
    return r.success ? r.data : s.parse({});
  };
  return {
    v: 1,
    layout: (LAYOUTS as readonly string[]).includes(raw.layout as string) ? (raw.layout as WidgetLayout) : "grid",
    selection: part(selectionSchema, raw.selection),
    filters: part(publicFiltersSchema, raw.filters),
    design: part(designSchema, raw.design),
    options: part(optionsSchema, raw.options),
    labels: part(labelsSchema, raw.labels),
    cta: part(ctaSchema, raw.cta),
    aggregate: part(aggregateSchema, raw.aggregate),
  };
}

/** The widget as the public feed sends it: display settings only (no filters, ids or form ids). */
export type PublicWidget = {
  id: string;
  layout: WidgetLayout;
  sort: "random" | null;
  /** How many leading testimonials are pinned (a shuffle leaves them first). */
  pinned: number;
  design: Omit<WidgetDesign, "font" | "firstNameOnly"> & {
    fontFamily: string;
    fontFile: string | null;
    /** The accent actually used (the design's, else the project's) and readable text on it (same formula as the app). */
    accent: string;
    onAccent: string;
  };
  options: WidgetOptions;
  labels: WidgetLabels;
  cta: { mode: "link" | "popup"; url: string; embedUrl: string } | null;
  aggregate: { show: boolean };
  /** Where the rating badge links: the project's wall. */
  wallUrl: string;
};

export type FeedImage = { url: string; alt: string | null };

/** A testimonial in a widget: the frozen public shape plus display extras (still no private field). */
export type FeedItem = {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  avatarUrl: string | null;
  rating: number | null;
  text: string | null;
  video: {
    url: string;
    mime: string;
    poster: string | null;
    width: number | null;
    height: number | null;
    durationMs: number | null;
    sources: { url: string; type: string }[];
    captionsUrl: string | null;
    transcript: string | null;
  } | null;
  tags: string[];
  createdAt: string;
  extra: {
    headline: string | null;
    /** When it was first posted (the review site's date for imports). */
    date: string;
    datePrecision: "day" | "month" | "year";
    platform: string | null;
    sourceUrl: string | null;
    /** Sent through one of this project's forms. */
    verified: boolean;
    images: FeedImage[];
    companyLogoUrl: string | null;
    /** Highlighted phrases in `text`, as [start, end) offsets. */
    highlights: { start: number; end: number }[];
  };
};

export type FeedAggregate = { count: number; average: number | null };

/** What GET /api/widget/w_… returns (and the studio preview). */
export type WidgetPayload = {
  project: { name: string; slug: string; accentColor: string } | null;
  widget: PublicWidget | null;
  testimonials: FeedItem[];
  aggregate: FeedAggregate;
};

/** DISP-09: the ways to put a saved widget on a site. `origin` is this server's public address. */
export function widgetSnippets(origin: string, id: string) {
  const o = origin.replace(/\/+$/, "");
  const hosted = `${o}/embed/${id}`;
  return {
    script: `<script src="${o}/widget.js" data-widget="${id}" async></script>`,
    iframe:
      `<iframe src="${hosted}" title="Testimonials" loading="lazy" style="width:100%;border:0;min-height:320px" data-plaudit-frame="${id}"></iframe>\n` +
      `<script>addEventListener("message",function(e){var d=e.data;if(e.origin==="${o}"&&d&&d.type==="plaudit:resize"&&d.slug==="${id}"){var f=document.querySelector('[data-plaudit-frame="${id}"]');if(f)f.style.height=d.height+"px"}})</script>`,
    hosted,
    react:
      `import { useEffect, useRef } from "react";\n\n` +
      `/** Plaudit widget ${id}. Renders client-side into its own shadow root. */\n` +
      `export function PlauditWidget({ id = "${id}" }) {\n` +
      `  const ref = useRef(null);\n` +
      `  useEffect(() => {\n` +
      `    const el = ref.current;\n` +
      `    if (!el) return;\n` +
      `    el.id = "plaudit-" + id;\n` +
      `    const s = document.createElement("script");\n` +
      `    s.src = "${o}/widget.js";\n` +
      `    s.async = true;\n` +
      `    s.dataset.widget = id;\n` +
      `    s.dataset.target = "#plaudit-" + id;\n` +
      `    document.body.appendChild(s);\n` +
      `    return () => s.remove();\n` +
      `  }, [id]);\n` +
      `  return <div ref={ref} />;\n` +
      `}\n`,
    html: `${o}/api/widget/${id}/html`,
    htmlWithJsonLd: `${o}/api/widget/${id}/html?jsonld=1`,
  };
}
export type WidgetSnippets = ReturnType<typeof widgetSnippets>;

/** Short install steps per site builder (our own wording); the full guides live in docs/embeds/. */
export const PLATFORM_GUIDES: { id: string; name: string; steps: string }[] = [
  { id: "wordpress", name: "WordPress", steps: "Add a Custom HTML block where the widget should go and paste the script snippet." },
  { id: "webflow", name: "Webflow", steps: "Drag an Embed element onto the page, paste the script snippet, then publish." },
  { id: "framer", name: "Framer", steps: "Insert an Embed component, choose HTML, and paste the script snippet." },
  { id: "wix", name: "Wix", steps: "Add › Embed code › Embed HTML, choose Code, and paste the iframe snippet." },
  { id: "squarespace", name: "Squarespace", steps: "Add a Code block, paste the script snippet, and turn off “Display source”." },
  { id: "shopify", name: "Shopify", steps: "In the theme editor add a Custom Liquid section and paste the script snippet." },
  { id: "ghost", name: "Ghost", steps: "In the editor add an HTML card and paste the script snippet." },
  { id: "notion", name: "Notion", steps: "Type /embed and paste the hosted link; Notion shows it in a frame." },
  { id: "nextjs", name: "Next.js", steps: "Copy the React component into your app and render <PlauditWidget /> in a client component." },
];
