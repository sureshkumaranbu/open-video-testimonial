import type { Metadata } from "next";
import { Newsreader, Schibsted_Grotesk } from "next/font/google";
import { env } from "@/lib/env";
import "./globals.css";
// After globals.css: Tailwind utilities and the theme tokens (docs/THEMING.md).
import "./theme.css";

// Self-hosted at build time by next/font: visitors never contact Google.
const ui = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-schibsted", display: "swap" });
const voice = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: { default: "Plaudit", template: "%s · Plaudit" },
  description: "Collect and share video and text testimonials. Open source and self-hosted.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme: the brand theme (PLAUDIT_THEME). The home page's boot script may also set `dark` and a preview theme here before paint.
    <html lang="en" className={`${ui.variable} ${voice.variable}`} data-theme={env.theme} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
