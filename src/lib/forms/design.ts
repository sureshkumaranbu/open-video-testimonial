import { textOn } from "../contrast";
import type { FormDesign } from "./schema";

/**
 * A form's look (FORM-08) as CSS custom properties on the runner's root, so
 * the builder's preview and the public page are styled by the very same
 * values. Fonts are self-hosted (public/fonts, or the app's own next/font
 * files), so a form never makes a third-party request. Client-safe.
 */

export type FormFontChoice = {
  id: string;
  label: string;
  /** The CSS font-family. */
  family: string;
  /** A woff2 under /fonts that needs an @font-face rule; null when the page already has the font. */
  file: string | null;
  fallback: string;
};

const SANS = "system-ui, -apple-system, \"Segoe UI\", sans-serif";
const SERIF = "\"Iowan Old Style\", \"Palatino Linotype\", Georgia, serif";

export const FONT_CHOICES: FormFontChoice[] = [
  { id: "schibsted", label: "Schibsted Grotesk", family: `var(--font-schibsted), ${SANS}`, file: null, fallback: SANS },
  { id: "newsreader", label: "Newsreader", family: `var(--font-newsreader), ${SERIF}`, file: null, fallback: SERIF },
  { id: "geist", label: "Geist", family: `"Plaudit Geist", ${SANS}`, file: "/fonts/geist-latin.woff2", fallback: SANS },
  {
    id: "geist-mono",
    label: "Geist Mono",
    family: "\"Plaudit Geist Mono\", ui-monospace, Menlo, Consolas, monospace",
    file: "/fonts/geist-mono-latin.woff2",
    fallback: "ui-monospace, monospace",
  },
  { id: "system", label: "System", family: SANS, file: null, fallback: SANS },
  { id: "serif", label: "Classic serif", family: SERIF, file: null, fallback: SERIF },
  { id: "rounded", label: "Rounded", family: `ui-rounded, "SF Pro Rounded", ${SANS}`, file: null, fallback: SANS },
];

const fontById = (id: string | undefined) => FONT_CHOICES.find((f) => f.id === id);

/** The @font-face rules a design needs (only for fonts served from /fonts). `origin` makes the URLs absolute for embeds. */
export function fontFaceCss(d: Pick<FormDesign, "headingFont" | "bodyFont">, origin = ""): string {
  const used = [...new Set([d.headingFont, d.bodyFont])].map(fontById).filter((f): f is FormFontChoice => Boolean(f?.file));
  return used
    .map((f) => {
      const name = f.family.split(",")[0];
      return `@font-face{font-family:${name};src:url(${origin}${f.file}) format("woff2");font-display:swap;font-weight:100 900}`;
    })
    .join("");
}

/** Ink or white, whichever has more contrast on `hex` (lib/contrast.ts). */
export const readableOn = (hex: string) => textOn(hex);

const THEMES = {
  light: { background: "#ffffff", text: "#161b2e" },
  dark: { background: "#12152a", text: "#eef0f7" },
};

/**
 * The design as custom properties (generalises theme.ts accentStyle):
 * `accent` is the project's colour, used where the form sets none. Also sets
 * --accent and --on-accent, which the shared buttons and recorder read.
 */
export function formDesignStyle(d: FormDesign, accent: string): Record<string, string> {
  const primary = d.primary ?? accent;
  const theme = THEMES[d.theme];
  const background = d.background ?? theme.background;
  const button = d.button ?? primary;
  const heading = fontById(d.headingFont);
  const body = fontById(d.bodyFont);
  return {
    "--accent": button,
    "--on-accent": d.buttonText ?? readableOn(button),
    "--fr-primary": primary,
    "--fr-on-primary": readableOn(primary),
    "--fr-bg": background,
    "--fr-text": d.text ?? (d.background ? readableOn(background) : theme.text),
    "--fr-button": button,
    "--fr-button-text": d.buttonText ?? readableOn(button),
    "--fr-star": d.star ?? "#f2a93b",
    "--star": d.star ?? "#f2a93b",
    "--fr-radius": `${d.radius}px`,
    "--fr-width": d.width === "compact" ? "520px" : "680px",
    ...(heading ? { "--fr-heading-font": heading.family } : {}),
    ...(body ? { "--fr-body-font": body.family } : {}),
  };
}

type BrandColors = Partial<Record<"primary" | "background" | "text" | "button" | "buttonText" | "star", string>>;

/** Colours and fonts the form leaves unset come from the project's brand kit (then the project colour, in formDesignStyle). */
export function designWithBrand(d: FormDesign, brand: { colors?: BrandColors; fonts?: { heading?: string; body?: string } } = {}): FormDesign {
  const c = brand.colors ?? {};
  return {
    ...d,
    primary: d.primary ?? c.primary,
    background: d.background ?? c.background,
    text: d.text ?? c.text,
    button: d.button ?? c.button,
    buttonText: d.buttonText ?? c.buttonText,
    star: d.star ?? c.star,
    headingFont: d.headingFont ?? brand.fonts?.heading,
    bodyFont: d.bodyFont ?? brand.fonts?.body,
  };
}
