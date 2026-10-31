"use client";

import { useEffect, useState } from "react";
import { MenuIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { MODES, type Mode } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { GitHubMark, Wordmark } from "./bits";
import { DASHBOARD, NAV, REPO } from "./content";
import { setMode, useMode } from "@/components/theme/mode";

/** One button: light ↔ dark. The three-way choice (with "system") is in the menu and the footer. */
export function ModeToggle({ className }: { className?: string }) {
  const [, dark] = useMode();
  return (
    <button
      type="button"
      data-testid="mode-toggle"
      aria-label="Dark mode"
      aria-pressed={dark}
      onClick={() => setMode(dark ? "light" : "dark")}
      className={cn(
        "relative inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent",
        "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      <SunIcon aria-hidden className="mode-icon size-5 dark:scale-50 dark:rotate-90 dark:opacity-0" />
      <MoonIcon aria-hidden className="mode-icon absolute size-5 scale-50 -rotate-90 opacity-0 dark:scale-100 dark:rotate-0 dark:opacity-100" />
    </button>
  );
}

const MODE_LABEL: Record<Mode, string> = { system: "System", light: "Light", dark: "Dark" };
const MODE_ICON = { system: MonitorIcon, light: SunIcon, dark: MoonIcon } as const;

/** Light, dark or follow the system: a radio group of three buttons. */
export function ModePicker({ className }: { className?: string }) {
  const [mode] = useMode();
  return (
    <div role="radiogroup" aria-label="Colour mode" className={cn("inline-flex gap-1 rounded-full bg-muted p-1", className)}>
      {MODES.map((m) => {
        const Icon = MODE_ICON[m];
        const on = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setMode(m)}
            onKeyDown={(e) => {
              const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
              if (!step) return;
              e.preventDefault();
              const next = MODES[(MODES.indexOf(m) + step + MODES.length) % MODES.length];
              setMode(next);
              (e.currentTarget.parentElement?.querySelector(`[data-mode="${next}"]`) as HTMLElement | null)?.focus();
            }}
            tabIndex={on ? 0 : -1}
            data-mode={m}
            className={cn(
              "inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors",
              "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring",
              on ? "bg-card text-foreground shadow-tile" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon aria-hidden className="size-4" />
            {MODE_LABEL[m]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Sticky header: transparent over the wall, then a blurred surface and a
 * hairline once the page scrolls. On phones the links move into a sheet.
 */
export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setContainer(document.getElementById("home-root"));
    let frame = 0;
    const update = () => {
      frame = 0;
      setScrolled(window.scrollY > 8);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header
      data-testid="home-nav"
      data-scrolled={scrolled ? "" : undefined}
      className={cn(
        "sticky top-0 z-40 border-b transition-[background-color,border-color,backdrop-filter] duration-300 ease-out",
        scrolled
          ? "border-border bg-background/80 backdrop-blur-xl backdrop-saturate-150"
          : "border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-[4.5rem] max-w-[82.5rem] items-center justify-between gap-4 px-4 sm:px-5">
        <a href="#top" className="-ml-1 flex min-h-11 items-center rounded-md px-1 focus-visible:outline-3 focus-visible:outline-ring" aria-label="Plaudit, back to top">
          <Wordmark />
        </a>
        <nav aria-label="Main" className="hidden items-center gap-7 font-medium text-muted-foreground lg:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="link-grow inline-flex min-h-11 items-center transition-colors hover:text-foreground">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <a
            href={REPO}
            aria-label="Plaudit on GitHub"
            className="hidden size-11 items-center justify-center rounded-full transition-colors hover:bg-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring sm:inline-flex"
          >
            <GitHubMark />
          </a>
          <ModeToggle />
          <Button asChild variant="inverse" size="sm" className="ml-1 hidden sm:inline-flex">
            <a href={DASHBOARD}>Open dashboard</a>
          </Button>
          <Sheet>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="Open menu"
                data-testid="menu-button"
                className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring lg:hidden"
              >
                <MenuIcon aria-hidden className="size-5" />
              </button>
            </SheetTrigger>
            <SheetContent container={container} data-testid="menu-sheet">
              <div>
                <SheetTitle>
                  <span className="sr-only">Menu</span>
                  <Wordmark />
                </SheetTitle>
                <SheetDescription className="sr-only">Sections of this page, and the dashboard.</SheetDescription>
              </div>
              <nav aria-label="Menu" className="flex flex-col">
                {NAV.map((n) => (
                  <SheetClose asChild key={n.href}>
                    <a
                      href={n.href}
                      className="flex min-h-12 items-center border-b border-border font-display text-xl font-bold tracking-tight focus-visible:outline-3 focus-visible:outline-ring"
                    >
                      {n.label}
                    </a>
                  </SheetClose>
                ))}
                <a href={REPO} className="flex min-h-12 items-center gap-2 border-b border-border font-display text-xl font-bold tracking-tight">
                  <GitHubMark />
                  GitHub
                </a>
              </nav>
              <ModePicker className="self-start" />
              <Button asChild variant="default" size="lg" className="mt-auto">
                <a href={DASHBOARD}>Open dashboard</a>
              </Button>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
