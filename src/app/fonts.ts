import { Bricolage_Grotesque } from "next/font/google";

/**
 * The display and interface face of the themed pages: the home page and the
 * dashboard (docs/THEMING.md). Self-hosted at build time by next/font, so
 * visitors never contact Google; only the pages that use its `variable`
 * class load it.
 */
export const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
  axes: ["opsz"],
});
