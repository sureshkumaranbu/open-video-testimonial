export type Theme = "light" | "dark";

export function parseTheme(value: string | string[] | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}
