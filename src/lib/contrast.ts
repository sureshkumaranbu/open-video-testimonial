/**
 * Colour contrast (WCAG 2.2, 1.4.3 and 1.4.11), shared by the builders'
 * warnings and by every place the app picks a text colour by itself.
 * Client-safe.
 */

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The app's dark ink, used for text on light colours. */
export const INK = "#161b2e";

/** "#ABC", "abc" and "#aabbcc" all become "#aabbcc"; anything else is null. */
export function normalizeHex(input: string): string | null {
  const m = HEX.exec(input.trim());
  if (!m) return null;
  const h = m[1].toLowerCase();
  return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
}

function channels(hex: string): [number, number, number] | null {
  const h = normalizeHex(hex);
  if (!h) return null;
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number | null {
  const c = channels(hex);
  if (!c) return null;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two colours (1 to 21), or null when either isn't a hex colour. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Ink or white, whichever has more contrast on `background` (white on a
 * tie or on anything unreadable). A brightness cut-off alone picks white on
 * mid-tones such as sky blue, where it reads at under 3:1.
 */
export function textOn(background: string, ink: string = INK): string {
  const dark = contrastRatio(background, ink);
  const light = contrastRatio(background, "#ffffff");
  if (dark == null || light == null) return "#ffffff";
  return dark > light ? ink : "#ffffff";
}

/** "4.5:1", rounded down to one decimal so a near miss never shows as a pass. */
export function formatRatio(ratio: number) {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`;
}

/** Of several [text, background] pairs (a light and a dark theme, say), the one that reads worst. */
export function worstPair(pairs: [string, string][]): [string, string] | undefined {
  let worst: { pair: [string, string]; ratio: number } | undefined;
  for (const pair of pairs) {
    const ratio = contrastRatio(pair[0], pair[1]);
    if (ratio != null && (!worst || ratio < worst.ratio)) worst = { pair, ratio };
  }
  return worst?.pair;
}
