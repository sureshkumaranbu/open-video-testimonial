/** Font choices for FontField. Plain data and a pure helper, so server code can use them too. */

export type FontChoice = {
  id: string;
  label: string;
  /** The CSS fallback stack, e.g. "Georgia, serif". */
  fallback?: string;
  /** The CSS font-family to preview with; defaults to the label, then the fallback. */
  family?: string;
};

/** The font-family a choice previews in. */
export function fontFamilyOf(c: FontChoice) {
  if (c.family) return c.family;
  // A quote or backslash in a label would end the CSS string early.
  const name = c.label.replace(/["\\]/g, "");
  return `"${name}", ${c.fallback ?? "system-ui, sans-serif"}`;
}
