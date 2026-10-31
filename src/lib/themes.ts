/**
 * Brand themes for the public pages (docs/THEMING.md). Each name here has one
 * `[data-brand="<name>"]` block in src/app/theme.css; adding a theme means
 * adding that block and its name to this list. Safe to import on the client.
 */
export const THEMES = ["violet", "tomato", "teal", "ink"] as const;
export type ThemeName = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemeName = "violet";

export function isTheme(value: unknown): value is ThemeName {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** A configured or requested name, or the default when it isn't one of ours. */
export function themeOr(value: unknown, fallback: ThemeName = DEFAULT_THEME): ThemeName {
  const v = typeof value === "string" ? value.trim().toLowerCase() : value;
  return isTheme(v) ? v : fallback;
}

/**
 * The home page's `?theme=` preview: a valid name wins over the configured
 * theme, anything else is ignored. Repeated parameters use the first.
 */
export function previewTheme(param: string | string[] | undefined, configured: ThemeName): ThemeName {
  const raw = Array.isArray(param) ? param[0] : param;
  return themeOr(raw, configured);
}

/** Visitor colour mode, kept in localStorage under MODE_KEY. */
export const MODES = ["system", "light", "dark"] as const;
export type Mode = (typeof MODES)[number];
export const MODE_KEY = "plaudit-mode";
