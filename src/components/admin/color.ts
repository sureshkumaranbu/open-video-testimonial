/** Colour helpers for ColorField and the builders' contrast warnings (WCAG 2.2, 1.4.3); the maths is in lib/contrast.ts. */

import { contrastRatio } from "@/lib/contrast";

export { contrastRatio, formatRatio, normalizeHex, relativeLuminance, textOn, worstPair } from "@/lib/contrast";

/** Black or white, whichever reads better on `background`. */
export function readableOn(background: string): "#000000" | "#ffffff" {
  const dark = contrastRatio(background, "#000000") ?? 21;
  const light = contrastRatio(background, "#ffffff") ?? 1;
  return dark >= light ? "#000000" : "#ffffff";
}
