import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Made-up examples of what a wall shows: decoration for the sign-in page, never real endorsements. */
const TILES = [
  {
    quote: "We had a wall of love on the pricing page before lunch.",
    name: "Priya N.",
    role: "Founder",
    tint: "bg-tint-1",
    place: "lg:translate-y-6",
  },
  {
    quote: "Customers record a video in a minute. No app, no account.",
    name: "Marcus L.",
    role: "Head of growth",
    tint: "bg-tint-3",
    place: "",
  },
  {
    quote: "Approving the best ones is the nicest part of my week.",
    name: "Dana K.",
    role: "Support lead",
    tint: "bg-tint-2",
    place: "lg:translate-y-4",
  },
  {
    quote: "Self-hosted, so our customers' words stay ours.",
    name: "Tom R.",
    role: "CTO",
    tint: "bg-tint-4",
    place: "lg:-translate-y-2",
  },
] as const;

function Wordmark() {
  return (
    <span className="font-display text-[1.625rem] leading-none font-extrabold tracking-display text-foreground">
      plaudit<span className="text-primary">.</span>
    </span>
  );
}

function Stars() {
  return (
    <span className="flex gap-0.5" aria-hidden>
      {[0, 1, 2, 3, 4].map((n) => (
        <svg key={n} viewBox="0 0 24 24" className="size-3.5 fill-[var(--star)]">
          <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" />
        </svg>
      ))}
    </span>
  );
}

/**
 * The sign-in pages' layout: on desktop a calm panel with a few sample wall
 * tiles beside the form; on phones the form alone, under the wordmark.
 */
export function SignInFrame({ children }: { children: ReactNode }) {
  return (
    <div className="ui-app">
      <div className="grid min-h-dvh bg-background text-foreground lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <section
          aria-hidden
          className="relative hidden flex-col justify-between gap-10 overflow-hidden border-r border-border bg-secondary p-10 lg:flex xl:p-14"
        >
          <Link href="/" tabIndex={-1} className="self-start">
            <Wordmark />
          </Link>
          <div className="flex flex-col gap-8">
            <p className="max-w-[18ch] font-display text-[2.375rem] leading-[1.08] font-bold tracking-tight text-balance">
              The best line on your homepage is one you didn&apos;t write.
            </p>
            <div className="grid max-w-[34rem] grid-cols-2 gap-4">
              {TILES.map((t, i) => (
                <figure
                  key={t.name}
                  style={{ ["--i" as string]: i }}
                  className={cn("signin-tile flex flex-col gap-3 rounded-[1.25rem] p-4 shadow-[var(--shadow-2)]", t.tint, t.place)}
                >
                  <Stars />
                  <blockquote className="text-[0.9375rem] leading-snug font-medium text-foreground">{t.quote}</blockquote>
                  <figcaption className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{t.name}</span> · {t.role}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Example testimonials, to show what a wall looks like.</p>
        </section>

        <main className="flex flex-col px-5 py-8 sm:px-8 lg:justify-center lg:py-12">
          <Link href="/" className="mb-10 self-start lg:hidden" aria-label="Plaudit home">
            <Wordmark />
          </Link>
          <div className="mx-auto flex w-full max-w-[24rem] flex-col gap-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** "or …" between sign-in methods. */
export function Divider({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-3 text-sm text-muted-foreground before:h-px before:flex-1 before:bg-border before:content-[''] after:h-px after:flex-1 after:bg-border after:content-['']">
      {children}
    </p>
  );
}
