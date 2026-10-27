import { z } from "zod";
import { INK, normalizeHex, textOn } from "./contrast";

/**
 * Review booster pages (BOOST-01..05): the config stored on a boosters row,
 * the Google review link helper, and the one renderer behind both the public
 * page and the editor's preview, so they can't drift apart. Client-safe: no
 * Node APIs and no database.
 *
 * BOOST-03, no gating: there is no rating step and nothing that hides a
 * link. Every visitor sees every link, in the owner's order. Links never
 * carry or mention a reward either (review sites forbid incentives that
 * depend on the review).
 */

if (typeof window !== "undefined") z.config({ jitless: true });

export const BOOSTER_PLATFORMS = [
  "google",
  "trustpilot",
  "yelp",
  "facebook",
  "g2",
  "capterra",
  "tripadvisor",
  "appstore",
  "googleplay",
  "custom",
  "form",
] as const;
export type BoosterPlatform = (typeof BOOSTER_PLATFORMS)[number];

/** Each platform's name, the lettermark in its icon (our own, never another company's logo) and a default button label. */
export const PLATFORMS: Record<BoosterPlatform, { name: string; mark: string; label: string }> = {
  google: { name: "Google", mark: "G", label: "Review us on Google" },
  trustpilot: { name: "Trustpilot", mark: "Tp", label: "Review us on Trustpilot" },
  yelp: { name: "Yelp", mark: "Ye", label: "Review us on Yelp" },
  facebook: { name: "Facebook", mark: "f", label: "Recommend us on Facebook" },
  g2: { name: "G2", mark: "G2", label: "Review us on G2" },
  capterra: { name: "Capterra", mark: "Ca", label: "Review us on Capterra" },
  tripadvisor: { name: "Tripadvisor", mark: "Ta", label: "Review us on Tripadvisor" },
  appstore: { name: "App Store", mark: "AS", label: "Rate us on the App Store" },
  googleplay: { name: "Google Play", mark: "GP", label: "Rate us on Google Play" },
  custom: { name: "Custom link", mark: "", label: "Leave a review" },
  form: { name: "Plaudit form", mark: "", label: "Share a testimonial" },
};

export const MAX_BOOSTER_LINKS = 10;
export const BUTTON_STYLES = ["solid", "outline", "soft"] as const;
export type ButtonStyle = (typeof BUTTON_STYLES)[number];

const HTTP_URL = /^https?:\/\/[^\s/?#]+\.[^\s]+$/i;

/** http(s) only: `javascript:`, `data:` and friends never get in, so the click redirect can't send anyone there. */
export function isHttpUrl(value: string): boolean {
  if (!HTTP_URL.test(value)) return false;
  try {
    const u = new URL(value);
    return (u.protocol === "https:" || u.protocol === "http:") && Boolean(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

const httpUrl = z
  .string()
  .trim()
  .max(2000, "That link is too long")
  .refine(isHttpUrl, "Links must be full web addresses starting with https:// (or http://)");
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1a2b3c");

export const boosterLinkSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]{1,16}$/),
    platform: z.enum(BOOSTER_PLATFORMS),
    /** Empty = the platform's default label. */
    label: z.string().trim().max(60).default(""),
    url: z.union([z.literal(""), httpUrl]).default(""),
    /** For a "form" link: one of the project's forms (its address is looked up when the page renders). */
    formId: z.string().max(64).nullable().default(null),
  })
  .superRefine((l, ctx) => {
    if (l.platform === "form" && !l.formId) ctx.addIssue({ code: "custom", message: "Choose which form the link opens", path: ["formId"] });
    if (l.platform !== "form" && !l.url) ctx.addIssue({ code: "custom", message: `Add the link for ${PLATFORMS[l.platform].name}`, path: ["url"] });
  });
export type BoosterLink = z.infer<typeof boosterLinkSchema>;

export const boosterLinksSchema = z
  .array(boosterLinkSchema)
  .max(MAX_BOOSTER_LINKS, `Up to ${MAX_BOOSTER_LINKS} links`)
  .refine((links) => new Set(links.map((l) => l.id)).size === links.length, "Two links share an id");

export const boosterDesignSchema = z.object({
  background: hex.default("#f6f7fb"),
  /** Text colour; empty picks a readable one for the background. */
  text: z.union([z.literal(""), hex]).default(""),
  button: hex.default("#161b2e"),
  /** Empty picks a readable one for the button. */
  buttonText: z.union([z.literal(""), hex]).default(""),
  buttonStyle: z.enum(BUTTON_STYLES).default("solid"),
  radius: z.number().int().min(0).max(24).default(12),
  showLogo: z.boolean().default(true),
});
export type BoosterDesign = z.infer<typeof boosterDesignSchema>;

export const defaultDesign = (): BoosterDesign => boosterDesignSchema.parse({});

function readJson(raw: string | null | undefined): unknown {
  try {
    return JSON.parse(raw || "null");
  } catch {
    return null;
  }
}

/** The links column; links that no longer parse are dropped one by one. */
export function parseLinks(raw: string | null | undefined): BoosterLink[] {
  const value = readJson(raw);
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((l) => {
      const parsed = boosterLinkSchema.safeParse(l);
      return parsed.success ? [parsed.data] : [];
    })
    .slice(0, MAX_BOOSTER_LINKS);
}

export function parseDesign(raw: string | null | undefined): BoosterDesign {
  const parsed = boosterDesignSchema.safeParse(readJson(raw) ?? {});
  return parsed.success ? parsed.data : defaultDesign();
}

/** Words that suggest the page promises something for a review: the editor warns (review sites forbid incentives). */
export const INCENTIVE_WORDS = /\b(rewards?|coupons?|discounts?|vouchers?|gifts?|prizes?|cashback|giveaways?|free gift)\b/i;

// ------------------------------------------------------------------ Google review links (BOOST-02)

export const GOOGLE_REVIEW_BASE = "https://search.google.com/local/writereview?placeid=";
const PLACE_ID = /^[A-Za-z0-9_-]{16,300}$/;

export type GoogleLinkResult = { ok: true; url: string; placeId: string | null } | { ok: false; error: string };

export const googleReviewUrl = (placeId: string) => `${GOOGLE_REVIEW_BASE}${encodeURIComponent(placeId)}`;

/**
 * Turns what the owner pasted into a Google "write a review" link: a Place
 * ID, a Maps link that carries one (place_id:, query_place_id=, !19s…), a
 * writereview link, or a g.page review link (kept as it is). Short links
 * (maps.app.goo.gl) can't be read without following them, so we ask for the
 * full address instead.
 */
export function googleReviewLink(input: string): GoogleLinkResult {
  const value = input.trim();
  if (!value) return { ok: false, error: "Paste a Google Maps link or a Place ID" };
  if (PLACE_ID.test(value) && !/^https?/i.test(value)) return { ok: true, url: googleReviewUrl(value), placeId: value };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "That isn't a Google Maps link or a Place ID" };
  }
  const host = url.hostname.toLowerCase();
  if (host === "maps.app.goo.gl" || host === "goo.gl") {
    return { ok: false, error: "Short links can't be read here. Open it, then copy the full address from your browser's address bar, or paste the Place ID." };
  }
  if (host === "g.page" && /^\/r\/[^/]+\/review\/?$/.test(url.pathname)) return { ok: true, url: `https://g.page${url.pathname}`, placeId: null };
  if (!/(^|\.)google\.[a-z.]{2,6}$/.test(host)) return { ok: false, error: "That isn't a Google Maps link. Paste a link from Google Maps, or a Place ID." };
  const params = url.searchParams;
  const fromParams =
    params.get("placeid") ?? params.get("place_id") ?? params.get("query_place_id") ?? /(?:^|\s)place_id:([A-Za-z0-9_-]+)/.exec(params.get("q") ?? "")?.[1] ?? null;
  const decoded = decodeURIComponent(url.pathname + url.search);
  const fromData = /!19s([A-Za-z0-9_-]{16,})/.exec(decoded)?.[1] ?? /\b(ChIJ[A-Za-z0-9_-]{10,})/.exec(decoded)?.[1] ?? null;
  const placeId = fromParams && PLACE_ID.test(fromParams) ? fromParams : fromData;
  if (placeId) return { ok: true, url: googleReviewUrl(placeId), placeId };
  return {
    ok: false,
    error: "This link doesn't include a Place ID. Search for the business below (if your server has a Places key), or look up its Place ID with Google's Place ID finder and paste that.",
  };
}

// ------------------------------------------------------------------ rendering

export type BoosterView = {
  title: string;
  message: string;
  projectName: string;
  logoUrl: string | null;
  design: BoosterDesign;
  /** Every link, in order (BOOST-03); `href` is the click counter on the public page. */
  links: { id: string; platform: BoosterPlatform; label: string; href: string }[];
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The icon for a platform: our own lettermark in a rounded square, or a link or speech-bubble glyph. */
export function platformIconSvg(platform: BoosterPlatform): string {
  const open = '<svg class="bst-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  if (platform === "custom") return `${open}<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>`;
  if (platform === "form") return `${open}<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M12 8.2l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 10.3l2-.3z"/></svg>`;
  const mark = PLATFORMS[platform].mark;
  return `${open}<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><text x="12" y="12" dy="0.35em" text-anchor="middle" fill="currentColor" stroke="none" font-size="${mark.length > 1 ? 8.5 : 11}" font-weight="700" font-family="system-ui,sans-serif">${esc(mark)}</text></svg>`;
}

/** The page's styles. Container queries (not media queries), so the editor's phone and desktop previews lay out like the real page. */
export function boosterCss(d: BoosterDesign): string {
  const bg = normalizeHex(d.background) ?? "#f6f7fb";
  const ink = (d.text && normalizeHex(d.text)) || textOn(bg, INK);
  const button = normalizeHex(d.button) ?? INK;
  const buttonInk = (d.buttonText && normalizeHex(d.buttonText)) || textOn(button, INK);
  const styles: Record<ButtonStyle, string> = {
    solid: `background:${button};color:${buttonInk};border:2px solid ${button};`,
    outline: `background:transparent;color:${ink};border:2px solid ${button};`,
    soft: `background:color-mix(in srgb,${button} 14%,${bg});color:${ink};border:2px solid transparent;`,
  };
  return `.bst-page{container-type:inline-size;box-sizing:border-box;min-height:100%;margin:0;padding:48px 16px;background:${bg};color:${ink};font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.5}
.bst-page *{box-sizing:border-box}
.bst-card{max-width:520px;margin:0 auto;display:flex;flex-direction:column;gap:16px;text-align:center}
.bst-logo{max-height:64px;max-width:200px;object-fit:contain;margin:0 auto}
.bst-mark{width:56px;height:56px;margin:0 auto;border-radius:16px;display:grid;place-items:center;font-weight:700;font-size:24px;background:${button};color:${buttonInk}}
.bst-title{font-size:1.75rem;line-height:1.2;margin:0;font-weight:700;overflow-wrap:anywhere}
.bst-message{margin:0;opacity:.85;white-space:pre-line;overflow-wrap:anywhere}
.bst-links{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:12px}
.bst-link{display:flex;align-items:center;gap:12px;min-height:52px;padding:12px 16px;border-radius:${d.radius}px;text-decoration:none;font-weight:600;font-size:1rem;text-align:start;${styles[d.buttonStyle]}}
.bst-link:hover{filter:brightness(.95)}
.bst-link:focus-visible{outline:3px solid ${ink};outline-offset:3px}
.bst-icon{width:24px;height:24px;flex:none}
.bst-label{flex:1;overflow-wrap:anywhere}
.bst-empty{opacity:.7;font-style:italic}
@container (min-width:720px){.bst-page{padding:96px 24px}.bst-title{font-size:2.25rem}.bst-links{grid-template-columns:1fr 1fr}.bst-links li:only-child{grid-column:1/-1}}`;
}

/** The page's markup (without <html>): the same string the public route serves and the editor previews. */
export function boosterMarkup(v: BoosterView, o: { preview?: boolean } = {}): string {
  const logo = v.design.showLogo
    ? v.logoUrl
      ? `<img class="bst-logo" src="${esc(v.logoUrl)}" alt="${esc(v.projectName)}">`
      : `<div class="bst-mark" aria-hidden="true">${esc(v.projectName.trim().charAt(0).toUpperCase() || "?")}</div>`
    : "";
  const target = o.preview ? ' target="_blank"' : "";
  const links = v.links.length
    ? `<ul class="bst-links">${v.links
        .map(
          (l) =>
            `<li><a class="bst-link" href="${esc(l.href)}" rel="nofollow noopener"${target} data-platform="${l.platform}" data-link="${esc(l.id)}">${platformIconSvg(l.platform)}<span class="bst-label">${esc(l.label)}</span></a></li>`,
        )
        .join("")}</ul>`
    : `<p class="bst-empty">${o.preview ? "Add a link to see it here." : "No review links yet."}</p>`;
  return `<main class="bst-page" data-testid="booster-page"><div class="bst-card">${logo}<h1 class="bst-title">${esc(v.title)}</h1>${
    v.message ? `<p class="bst-message">${esc(v.message)}</p>` : ""
  }${links}</div></main>`;
}

/** The whole public page: no scripts, no fonts, no third-party anything. */
export function boosterDocument(v: BoosterView, o: { canonical: string; lang?: string }): string {
  const description = v.message || v.title;
  return `<!doctype html><html lang="${esc(o.lang ?? "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(
    v.title || v.projectName,
  )}</title><meta name="description" content="${esc(description.slice(0, 200))}"><link rel="canonical" href="${esc(o.canonical)}"><style>html,body{margin:0;height:100%}${boosterCss(v.design)}</style></head><body>${boosterMarkup(v)}</body></html>`;
}

/** The title when the owner leaves it empty. */
export const defaultBoosterTitle = (projectName: string) => `Enjoying ${projectName}?`;
export const DEFAULT_BOOSTER_MESSAGE = "A short review helps other people find us. Pick the site you use most: it only takes a minute.";
