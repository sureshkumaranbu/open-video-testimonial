import { z } from "zod";

/**
 * The image studio's design (SHARE-01, SHARE-02): template, size, theme,
 * colours, background and logo. Client-safe (zod only), so the studio checks
 * a change with the schema the server renders and saves it with. Content
 * (which testimonials, and any wording override) is never part of a design,
 * so a saved template is reusable with any testimonial.
 */

// zod's JIT compiles with new Function, which the dashboard's CSP forbids.
if (typeof window !== "undefined") z.config({ jitless: true });

/** Our own templates. `max` is how many testimonials one image shows. */
export const SHARE_TEMPLATES = [
  { id: "spotlight", name: "Spotlight", blurb: "One big quote, centred", max: 1 },
  { id: "margin", name: "Margin note", blurb: "A bold bar beside the words", max: 1 },
  { id: "postcard", name: "Postcard", blurb: "A card resting on the background", max: 1 },
  { id: "headline", name: "Headline", blurb: "The headline large, the quote below", max: 1 },
  { id: "portrait", name: "Portrait", blurb: "The person's photo leads", max: 1 },
  { id: "split", name: "Split", blurb: "A colour panel for the person", max: 1 },
  { id: "bubble", name: "Speech bubble", blurb: "Words in a bubble, the person below", max: 1 },
  { id: "stamp", name: "Rating stamp", blurb: "The stars as a big badge", max: 1 },
  { id: "minimal", name: "Plain", blurb: "Only the words and the name", max: 1 },
  { id: "ticket", name: "Ticket", blurb: "Quote and person either side of a perforation", max: 1 },
  { id: "trio", name: "Three columns", blurb: "Three testimonials side by side", max: 3 },
  { id: "stack", name: "Stack", blurb: "Up to three, one above the other", max: 3 },
  { id: "grid", name: "Grid of six", blurb: "Up to six small cards", max: 6 },
  { id: "mosaic", name: "Mosaic", blurb: "One large and up to five small", max: 6 },
] as const;
export type ShareTemplateId = (typeof SHARE_TEMPLATES)[number]["id"];
const TEMPLATE_IDS = SHARE_TEMPLATES.map((t) => t.id) as [ShareTemplateId, ...ShareTemplateId[]];

export const templateInfo = (id: ShareTemplateId) => SHARE_TEMPLATES.find((t) => t.id === id) ?? SHARE_TEMPLATES[0];

/** Sizes people post at. `email` is a 600×200 banner. */
export const SIZE_PRESETS = [
  { id: "square", label: "Square 1:1", width: 1080, height: 1080 },
  { id: "portrait", label: "Portrait 4:5", width: 1080, height: 1350 },
  { id: "story", label: "Story 9:16", width: 1080, height: 1920 },
  { id: "landscape", label: "Landscape 16:9", width: 1920, height: 1080 },
  { id: "linkedin", label: "LinkedIn post", width: 1200, height: 627 },
  { id: "x", label: "X post", width: 1600, height: 900 },
  { id: "email", label: "Email banner", width: 600, height: 200 },
] as const;
export type SizePresetId = (typeof SIZE_PRESETS)[number]["id"] | "custom";
const PRESET_IDS = ["custom", ...SIZE_PRESETS.map((s) => s.id)] as [SizePresetId, ...SizePresetId[]];

/** Custom sizes: each side within these, and at most this many pixels in all (a 2048² image). */
export const MIN_SIDE = 200;
export const MAX_SIDE = 2400;
export const MAX_PIXELS = 2048 * 2048;

export const BACKGROUND_KINDS = ["solid", "gradient", "pattern", "image", "transparent"] as const;
export const PATTERNS = ["dots", "grid", "diagonal", "waves", "confetti"] as const;
export const PATTERN_LABELS: Record<(typeof PATTERNS)[number], string> = {
  dots: "Dots",
  grid: "Grid",
  diagonal: "Diagonal lines",
  waves: "Waves",
  confetti: "Confetti",
};
export const LOGO_SOURCES = ["none", "brand", "upload"] as const;
export const LOGO_POSITIONS = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"] as const;

/** TTF fonts satori can draw (public/fonts/og/). Only Geist ships; others light up when their file is added. */
export const SHARE_FONTS = [
  { id: "geist", label: "Geist", file: "Geist-Regular.ttf" },
  { id: "geist-mono", label: "Geist Mono", file: "GeistMono-Regular.ttf" },
  { id: "schibsted", label: "Schibsted Grotesk", file: "SchibstedGrotesk-Regular.ttf" },
  { id: "newsreader", label: "Newsreader", file: "Newsreader-Regular.ttf" },
] as const;
export type ShareFontId = (typeof SHARE_FONTS)[number]["id"];
const FONT_IDS = SHARE_FONTS.map((f) => f.id) as [ShareFontId, ...ShareFontId[]];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour such as #e2463f");
/** "" = the theme's (or the project's) own colour. */
const colour = z.union([hex, z.literal("")]).default("");
const assetId = z.union([z.string().regex(/^[0-9a-f-]{36}$/), z.literal("")]).default("");

export const backgroundSchema = z.object({
  kind: z.enum(BACKGROUND_KINDS).default("solid"),
  /** Solid colour, the gradient's first stop, or the pattern's base; "" = the theme's. */
  color: colour,
  color2: colour,
  /** Gradient direction in degrees. */
  angle: z.number().int().min(0).max(360).default(135),
  pattern: z.enum(PATTERNS).default("dots"),
  /** An uploaded background (share_assets, kind background). */
  assetId,
  /** Darkens an image so the words stay readable, 0–80 %. */
  dim: z.number().int().min(0).max(80).default(45),
});

export const logoSchema = z.object({
  source: z.enum(LOGO_SOURCES).default("none"),
  assetId,
  position: z.enum(LOGO_POSITIONS).default("top-left"),
  /** Height in px at 1080 px across; scaled with the image. */
  size: z.number().int().min(16).max(320).default(64),
});

export const sizeSchema = z
  .object({
    preset: z.enum(PRESET_IDS).default("square"),
    width: z.number().int().min(MIN_SIDE).max(MAX_SIDE).default(1080),
    height: z.number().int().min(MIN_SIDE).max(MAX_SIDE).default(1080),
  })
  .refine((s) => s.preset !== "custom" || s.width * s.height <= MAX_PIXELS, `Keep custom sizes under ${MAX_PIXELS.toLocaleString("en")} pixels (2048 × 2048)`);

export const shareDesignSchema = z.object({
  v: z.literal(1).default(1),
  template: z.enum(TEMPLATE_IDS).default("spotlight"),
  size: sizeSchema.default({ preset: "square", width: 1080, height: 1080 }),
  theme: z.enum(["light", "dark"]).default("light"),
  /** Quote marks, stars' panel, bars; "" = the project's colour. */
  accent: colour,
  /** Behind highlighted words (the testimonial's saved highlights, or **words** in an override). */
  highlight: hex.default("#ffe066"),
  /** The words; "" = readable on the background. */
  text: colour,
  font: z.enum(FONT_IDS).default("geist"),
  background: backgroundSchema.default(backgroundSchema.parse({})),
  logo: logoSchema.default(logoSchema.parse({})),
  showRating: z.boolean().default(true),
  showAvatar: z.boolean().default(true),
  /** Job title and company under the name. */
  showTitle: z.boolean().default(true),
});
export type ShareDesign = z.output<typeof shareDesignSchema>;
export type ShareDesignInput = z.input<typeof shareDesignSchema>;

export const defaultShareDesign = (): ShareDesign => shareDesignSchema.parse({});

/** The pixel size a design renders at. */
export function designSize(d: Pick<ShareDesign, "size">): { width: number; height: number } {
  if (d.size.preset === "custom") return { width: d.size.width, height: d.size.height };
  const p = SIZE_PRESETS.find((s) => s.id === d.size.preset) ?? SIZE_PRESETS[0];
  return { width: p.width, height: p.height };
}

/**
 * A content override for one testimonial (SHARE-01): used for this image
 * only, never saved to the testimonial. `**words**` in the text are highlighted.
 */
export const shareOverrideSchema = z.object({
  id: z.string().regex(/^[0-9a-f-]{36}$/, "Choose a testimonial"),
  text: z.string().max(1200).optional(),
  name: z.string().trim().max(120).optional(),
  byline: z.string().trim().max(160).optional(),
});
export type ShareOverride = z.infer<typeof shareOverrideSchema>;

export const SHARE_FORMATS = ["png", "jpeg"] as const;
export type ShareFormat = (typeof SHARE_FORMATS)[number];

/** One image: a design and the testimonials it shows (1 to 6, in order). */
export const renderSpecSchema = z.object({
  design: shareDesignSchema,
  items: z.array(shareOverrideSchema).min(1, "Choose at least one testimonial").max(6, "An image shows at most six testimonials"),
});
export type RenderSpec = z.infer<typeof renderSpecSchema>;

/** The most images one ZIP holds. */
export const MAX_ZIP_IMAGES = 12;

/**
 * The project's brand kit as studio settings (SHARE-02): its colours, its
 * heading font when the image renderer has that font, and its logo.
 */
export function brandDesign(
  brand: { colors?: Partial<Record<"primary" | "background" | "text" | "button" | "buttonText" | "star", string>>; fonts?: { heading?: string; body?: string } },
  o: { hasLogo: boolean; fonts: readonly string[] },
): Partial<Omit<ShareDesign, "background" | "logo">> & { background: Partial<ShareDesign["background"]>; logo: Partial<ShareDesign["logo"]> } {
  const c = brand.colors ?? {};
  const font = [brand.fonts?.heading, brand.fonts?.body].find((f): f is ShareFontId => Boolean(f) && o.fonts.includes(f!));
  return {
    ...(c.primary ? { accent: c.primary } : {}),
    ...(c.text ? { text: c.text } : {}),
    ...(font ? { font } : {}),
    background: c.background ? { kind: "solid" as const, color: c.background } : {},
    logo: o.hasLogo ? { source: "brand" as const } : {},
  };
}
