import { z } from "zod";
import { SEO_SCHEMA_TYPES } from "./seo";
import { DATE_MODES, FEED_TYPES, WIDGET_FONTS, type WidgetFontId } from "./widget-config";

/**
 * A wall's configuration (WALL-01..03): hero, header, cards, tabs, the inline
 * call to action, which testimonials and the page's SEO. The theme, cover,
 * logo, featured testimonial and connected form are columns of their own.
 * Client-safe (zod only), so the editor checks a change with the schema the
 * server stores it with. Every section has defaults, so an older or partial
 * config still parses.
 */

// zod's JIT compiles with new Function, which the dashboard's CSP forbids.
if (typeof window !== "undefined") z.config({ jitless: true });

/** Our own themes. "paper" matches the legacy wall. */
export const WALL_THEMES = ["paper", "night", "sunrise", "meadow", "studio"] as const;
export type WallTheme = (typeof WALL_THEMES)[number];

export const THEME_LABELS: Record<WallTheme, { name: string; blurb: string }> = {
  paper: { name: "Paper", blurb: "Quiet greys, white cards" },
  night: { name: "Night", blurb: "Dark navy, soft light text" },
  sunrise: { name: "Sunrise", blurb: "Warm cream with coral" },
  meadow: { name: "Meadow", blurb: "Pale green, rounded cards" },
  studio: { name: "Studio", blurb: "Black and white, big type" },
};

/** A swatch for each theme (the editor's picker; the page itself uses wall-view.css). */
export const THEME_SWATCHES: Record<WallTheme, { bg: string; card: string; ink: string; accent: string }> = {
  paper: { bg: "#f6f7f9", card: "#ffffff", ink: "#161b2e", accent: "#161b2e" },
  night: { bg: "#0f1220", card: "#171b2b", ink: "#eef0f6", accent: "#8fa8ff" },
  sunrise: { bg: "#fff4ea", card: "#ffffff", ink: "#3b1f14", accent: "#e8603c" },
  meadow: { bg: "#eef6ef", card: "#fbfefb", ink: "#17301f", accent: "#2f7d4f" },
  studio: { bg: "#ffffff", card: "#ffffff", ink: "#0a0a0a", accent: "#0a0a0a" },
};

export function parseWallTheme(v: unknown): WallTheme {
  return (WALL_THEMES as readonly string[]).includes(v as string) ? (v as WallTheme) : "paper";
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour such as #e2463f");
/** "" means "the theme's own colour". */
const colour = z.union([hex, z.literal("")]).default("");

/** A link on the page: a full web address, or a path on this server. Never javascript: or data:. */
export const linkSchema = z.union([
  z.literal(""),
  z
    .string()
    .trim()
    .max(500)
    // No backslashes: browsers read "/\evil.example" as another site.
    .regex(/^(https?:\/\/[^\s<>"\\]+|\/(?![\/\\])[^\s<>"\\]*)$/i, "Use a full web address starting with https://"),
]);

const FONT_IDS = WIDGET_FONTS.map((f) => f.id) as [WidgetFontId, ...WidgetFontId[]];

export const heroSchema = z.object({
  title: z.string().trim().max(120).default(""),
  subtitle: z.string().trim().max(300).default(""),
  align: z.enum(["center", "left"]).default("center"),
  background: colour,
  text: colour,
  /** The total and the average rating under the title. */
  showStats: z.boolean().default(true),
  /** The featured testimonial (the featured_testimonial_id column) in the hero. */
  showFeatured: z.boolean().default(true),
});

export const heroCtaSchema = z.object({
  enabled: z.boolean().default(true),
  text: z.string().trim().max(40).default("Share your story"),
  /** "" = the connected form (or the project's default form). */
  url: linkSchema.default(""),
  background: colour,
  color: colour,
});

export const navLinkSchema = z.object({
  label: z.string().trim().min(1, "Give the link a label").max(30),
  url: linkSchema.refine((v) => v !== "", "Add the link's address"),
});

export const cardSchema = z.object({
  background: colour,
  text: colour,
  border: colour,
  radius: z.number().int().min(0).max(32).default(16),
  shadow: z.boolean().default(true),
});

export const PAGINATION = ["load_more", "infinite"] as const;

export const layoutSchema = z.object({
  /** The most columns on a wide screen (fewer on phones). */
  columns: z.number().int().min(1).max(4).default(3),
  /** load_more: a button; infinite: the next page loads near the bottom (the button stays as a fallback). */
  pagination: z.enum(PAGINATION).default("load_more"),
  pageSize: z.number().int().min(3).max(48).default(12),
});

/** The DISP-03 card toggles, for walls. */
export const displaySchema = z.object({
  showRating: z.boolean().default(true),
  showVideo: z.boolean().default(true),
  showImages: z.boolean().default(true),
  showAvatar: z.boolean().default(true),
  showTitle: z.boolean().default(true),
  showHeadline: z.boolean().default(true),
  showSource: z.boolean().default(false),
  showVerified: z.boolean().default(false),
  date: z.enum(DATE_MODES).default("hidden"),
});

export const tabSchema = z.object({
  label: z.string().trim().min(1, "Give the tab a label").max(30),
  /** "" = every testimonial on the wall. */
  tag: z.string().trim().toLowerCase().max(32).default(""),
});

export const tabsSchema = z.object({
  enabled: z.boolean().default(false),
  items: z.array(tabSchema).max(8).default([]),
  /** Index of the tab a visitor sees first. */
  defaultTab: z.number().int().min(0).max(7).default(0),
});

export const inlineCtaSchema = z.object({
  enabled: z.boolean().default(false),
  /** Shown after this many cards. */
  after: z.number().int().min(1).max(48).default(6),
  title: z.string().trim().max(80).default("Have a story of your own?"),
  text: z.string().trim().max(200).default(""),
  buttonText: z.string().trim().max(40).default("Leave a testimonial"),
  /** "" = the connected form (or the project's default form). */
  url: linkSchema.default(""),
});

/** Which testimonials the wall shows (on top of the public rule). */
export const wallFiltersSchema = z.object({
  minRating: z.number().int().min(0).max(5).default(0),
  type: z.enum(FEED_TYPES).default("any"),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(32)).max(20).default([]),
  sort: z.enum(["newest", "oldest", "rating", "manual"]).default("newest"),
});

export const wallSeoSchema = z.object({
  /** "" = the hero title, else the wall's name. */
  title: z.string().trim().max(70).default(""),
  description: z.string().trim().max(200).default(""),
  noindex: z.boolean().default(false),
  schemaType: z.enum(SEO_SCHEMA_TYPES).default("Product"),
  /** What the reviews are about; "" = the project's name. */
  itemName: z.string().trim().max(120).default(""),
});

export const wallConfigSchema = z.object({
  v: z.literal(1).default(1),
  hero: heroSchema.default(heroSchema.parse({})),
  heroCta: heroCtaSchema.default(heroCtaSchema.parse({})),
  nav: z.array(navLinkSchema).max(4, "Up to 4 header links").default([]),
  /** Where the header logo links; "" = no link. */
  logoLink: linkSchema.default(""),
  font: z.enum(FONT_IDS).default("default"),
  card: cardSchema.default(cardSchema.parse({})),
  layout: layoutSchema.default(layoutSchema.parse({})),
  display: displaySchema.default(displaySchema.parse({})),
  tabs: tabsSchema.default(tabsSchema.parse({})),
  inlineCta: inlineCtaSchema.default(inlineCtaSchema.parse({})),
  filters: wallFiltersSchema.default(wallFiltersSchema.parse({})),
  seo: wallSeoSchema.default(wallSeoSchema.parse({})),
});
export type WallConfig = z.output<typeof wallConfigSchema>;
export type WallConfigInput = z.input<typeof wallConfigSchema>;
export type WallDisplay = WallConfig["display"];

export function defaultWallConfig(o: { title?: string } = {}): WallConfig {
  return wallConfigSchema.parse({ hero: { title: o.title ?? "" } });
}

/** Parses each section on its own, so one unreadable part falls back to its defaults instead of the whole wall. */
export function parseWallConfigLenient(raw: unknown): WallConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const part = <S extends z.ZodType>(s: S, v: unknown, fallback: unknown = {}): z.output<S> => {
    const p = s.safeParse(v ?? fallback);
    return p.success ? p.data : s.parse(fallback);
  };
  return {
    v: 1,
    hero: part(heroSchema, r.hero),
    heroCta: part(heroCtaSchema, r.heroCta),
    nav: part(wallConfigSchema.shape.nav, r.nav, []),
    logoLink: part(wallConfigSchema.shape.logoLink, r.logoLink, ""),
    font: part(wallConfigSchema.shape.font, r.font, "default"),
    card: part(cardSchema, r.card),
    layout: part(layoutSchema, r.layout),
    display: part(displaySchema, r.display),
    tabs: part(tabsSchema, r.tabs),
    inlineCta: part(inlineCtaSchema, r.inlineCta),
    filters: part(wallFiltersSchema, r.filters),
    seo: part(wallSeoSchema, r.seo),
  };
}

/** The tabs a visitor can pick, always at least one ("All"). */
export function wallTabs(cfg: WallConfig): { label: string; tag: string }[] {
  return cfg.tabs.enabled && cfg.tabs.items.length ? cfg.tabs.items : [{ label: "All", tag: "" }];
}

/** The tab index a `?tab=` value asks for, else the default tab. */
export function resolveTab(cfg: WallConfig, raw: string | string[] | undefined | null): number {
  const tabs = wallTabs(cfg);
  const n = typeof raw === "string" && /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
  if (Number.isInteger(n) && n >= 0 && n < tabs.length) return n;
  return Math.min(cfg.tabs.defaultTab, tabs.length - 1);
}
