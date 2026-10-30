import type { Metadata } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import { env } from "@/lib/env";
import { previewTheme } from "@/lib/themes";
import { bootScript } from "./_home/boot";
import { Features } from "./_home/Features";
import { Header } from "./_home/Header";
import { HeroWall } from "./_home/HeroWall";
import { HowItWorks } from "./_home/HowItWorks";
import { InView } from "./_home/InView";
import { Platforms } from "./_home/Platforms";
import { Compare, Faq, FinalCta, Footer, SelfHost } from "./_home/Sections";
import { Studio } from "./_home/Studio";
import "./home.css";

// Self-hosted at build time by next/font: visitors never contact Google. Only this page loads it.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: { absolute: "Plaudit: video and text testimonials, self-hosted" },
  description: "Collect video and text testimonials, approve the best and show them on your site. Free, open source and self-hosted.",
};

/**
 * The public home page: a wall of love on top, then how it works, the widget
 * studio, features, self-hosting, the comparison, the FAQ and a closing call.
 * Its brand theme comes from PLAUDIT_THEME, or `?theme=<name>` to preview one
 * (docs/THEMING.md).
 */
export default async function Home({ searchParams }: { searchParams: Promise<{ theme?: string | string[] }> }) {
  const configured = env.theme;
  const theme = previewTheme((await searchParams).theme, configured);
  return (
    <div
      id="home-root"
      className={`ui-home ${display.variable}`}
      data-theme={theme}
      data-testid="home"
      suppressHydrationWarning
    >
      <script dangerouslySetInnerHTML={{ __html: bootScript(theme === configured ? null : theme) }} />
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-foreground px-5 py-3 font-semibold text-background focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Header />
      <main id="main">
        <HeroWall />
        <Platforms />
        <HowItWorks />
        <Studio />
        <Features />
        <SelfHost />
        <Compare />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <InView />
    </div>
  );
}
