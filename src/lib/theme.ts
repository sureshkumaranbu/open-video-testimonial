import { textOn } from "./contrast";

export type Theme = "light" | "dark";

export function parseTheme(value: string | string[] | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}

/**
 * CSS custom properties for a project's brand colour, with a readable text
 * colour on top of it: ink or white, whichever has more contrast.
 */
export function accentStyle(hex: string): Record<string, string> {
  return { "--accent": hex, "--on-accent": textOn(hex) };
}
