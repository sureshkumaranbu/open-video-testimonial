export type Theme = "light" | "dark";

export function parseTheme(value: string | string[] | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}

/** Relative luminance of a #rrggbb colour (WCAG formula). */
function luminance(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/**
 * CSS custom properties for a project's brand colour, with a readable text
 * colour on top of it (white on dark brands, ink on light ones).
 */
export function accentStyle(hex: string): Record<string, string> {
  const onAccent = luminance(hex) > 0.4 ? "#161b2e" : "#ffffff";
  return { "--accent": hex, "--on-accent": onAccent };
}
