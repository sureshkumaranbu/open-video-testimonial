"use client";

import { useState } from "react";
import { flushSync } from "react-dom";
import { PlayIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Face, Stars } from "./bits";
import { CopyButton } from "./CopyButton";
import { LAYOUTS, SNIPPET, type StudioLayout } from "./content";
import { byId, PEOPLE, type SamplePerson } from "./samples";

type Card = { id: string; person: SamplePerson; text: string; tint: string; video?: boolean };

const CARDS: Card[] = [
  { id: "ken", person: PEOPLE.ken, text: "Our first video testimonial was live twenty minutes after install.", tint: "bg-tint-2" },
  { id: "maya", person: PEOPLE.maya, text: byId("maya").quote, tint: "bg-tint-1", video: true },
  { id: "leila", person: PEOPLE.leila, text: "Students record on their phones. I approve over coffee.", tint: "bg-tint-3" },
  { id: "theo", person: PEOPLE.theo, text: "We embed a different tag per client page. Zero CSS fights.", tint: "bg-tint-5" },
];

const STAGE: Record<StudioLayout, string> = {
  grid: "grid grid-cols-2 items-start gap-2.5 sm:grid-cols-3",
  carousel: "grid h-full grid-cols-1 content-center justify-items-center pb-5",
  slider: "flex items-start gap-2.5",
  marquee: "flex items-start gap-2.5 studio-marquee",
  featured: "grid h-full grid-cols-1 content-center",
};

/** Which cards each layout shows (the rest leave the stage). */
const VISIBLE: Record<StudioLayout, string[]> = {
  grid: ["ken", "maya", "leila", "theo"],
  carousel: ["maya"],
  slider: ["ken", "maya", "leila", "theo"],
  marquee: ["ken", "leila", "theo", "maya"],
  featured: ["theo"],
};

function PreviewCard({ card, layout, index }: { card: Card; layout: StudioLayout; index: number }) {
  const v = byId("maya");
  const big = layout === "featured" || layout === "carousel";
  return (
    <article
      data-testid="studio-card"
      className={cn(
        "studio-card flex flex-col gap-2.5 rounded-lg p-3.5 text-foreground",
        card.tint,
        (layout === "slider" || layout === "marquee") && "w-[46%] shrink-0 sm:w-[38%]",
        layout === "carousel" && "w-full max-w-[22rem]",
        layout === "featured" && "mx-auto w-full max-w-[30rem] p-7",
        layout === "grid" && index === 2 && "sm:pb-10",
      )}
      style={{ viewTransitionName: `studio-${card.id}` }}
    >
      {card.video && (
        <span className="relative block overflow-hidden rounded-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={v.poster}
            alt=""
            width={v.width}
            height={v.height}
            loading="lazy"
            decoding="async"
            className="aspect-[16/10] h-auto w-full object-cover"
            style={{ objectPosition: "34% 30%" }}
          />
          <span className="absolute top-2 left-2 grid size-7 place-items-center rounded-full bg-white text-[#1b1530]">
            <PlayIcon aria-hidden className="ml-px size-3 fill-current" />
          </span>
        </span>
      )}
      <Stars rating={5} size={big ? 16 : 13} />
      <p className={cn("leading-snug font-medium", layout === "featured" ? "text-xl tracking-tight" : big ? "text-base" : "text-sm")}>
        {card.text}
      </p>
      <span className="mt-auto flex items-center gap-2 text-xs">
        <Face person={card.person} size={24} />
        <strong>{card.person.name}</strong>
        <span className="truncate text-muted-foreground">{card.person.company}</span>
      </span>
    </article>
  );
}

/**
 * The widget studio, in miniature: pick a layout and the preview rearranges.
 * Cards keep their identity between layouts (a View Transition morphs each
 * one to its new place); without View Transitions, or with reduced motion,
 * it's a plain swap.
 */
export function Studio() {
  const [layout, setLayout] = useState<StudioLayout>("grid");

  function pick(next: StudioLayout) {
    if (next === layout) return;
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || reduce) {
      setLayout(next);
      return;
    }
    document.documentElement.dataset.vt = "studio";
    const t = doc.startViewTransition(() => flushSync(() => setLayout(next))) as { finished?: Promise<void> };
    void t.finished?.finally(() => delete document.documentElement.dataset.vt);
  }

  const cards = VISIBLE[layout].map((id) => CARDS.find((c) => c.id === id)!);
  const name = LAYOUTS.find((l) => l.id === layout)!.label;

  return (
    <section
      id="studio"
      data-testid="section-studio"
      aria-labelledby="studio-title"
      className="border-y border-border bg-card py-20 md:py-28"
    >
      <div className="mx-auto grid max-w-[82.5rem] items-center gap-12 px-4 sm:px-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <div>
          <h2 id="studio-title" className="font-display text-[clamp(2.25rem,1.6rem+2.6vw,3.5rem)] leading-[1] font-extrabold tracking-display text-balance">
            Pick a layout. Paste one line.
          </h2>
          <p className="mt-5 max-w-[44ch] text-lg text-muted-foreground">
            Design a widget in the studio, then paste its snippet. Widgets take your brand colour and font, follow light or
            dark mode, and work on WordPress, Webflow, Framer, Shopify or any page.
          </p>
          <div role="group" aria-label="Widget layout" className="mt-8 flex flex-wrap gap-2" data-testid="studio-layouts">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={layout === l.id}
                onClick={() => pick(l.id)}
                className={cn(
                  "h-11 cursor-pointer rounded-full border-[1.5px] px-[1.125rem] text-sm font-semibold transition-[background-color,color,border-color,scale] duration-200 ease-out",
                  "focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ring motion-safe:active:scale-[0.96]",
                  layout === l.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-foreground hover:border-foreground/40",
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 rounded-xl bg-muted p-3 sm:p-6 lg:p-8">
          <div className="overflow-hidden rounded-lg border border-border bg-background p-3 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5" aria-hidden>
                <span className="size-2.5 rounded-full bg-foreground/15" />
                <span className="size-2.5 rounded-full bg-foreground/15" />
                <span className="size-2.5 rounded-full bg-foreground/15" />
              </span>
              <span aria-live="polite">
                Preview: <strong className="font-semibold text-foreground">{name}</strong>, with sample testimonials
              </span>
            </div>
            <div className="studio-stage relative h-[21rem] overflow-hidden" data-testid="studio-preview" data-layout={layout}>
              <div className={STAGE[layout]}>
                {layout === "grid"
                  ? [0, 1, 2].map((col) => (
                      <div key={col} className={cn("flex flex-col gap-2.5", col === 2 && "max-sm:hidden")}>
                        {cards
                          .filter((_, i) => i % 3 === col)
                          .map((c) => (
                            <PreviewCard key={c.id} card={c} layout={layout} index={cards.indexOf(c)} />
                          ))}
                      </div>
                    ))
                  : cards.map((c, i) => <PreviewCard key={c.id} card={c} layout={layout} index={i} />)}
              </div>
              {layout === "carousel" && (
                <div className="absolute inset-x-0 bottom-1 flex justify-center gap-1.5" aria-hidden>
                  {[0, 1, 2, 3].map((d) => (
                    <span key={d} className={cn("h-1.5 rounded-full", d === 0 ? "w-5 bg-foreground" : "w-1.5 bg-foreground/25")} />
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="mt-3.5 flex items-center gap-2.5 rounded-full bg-foreground py-1.5 pr-1.5 pl-5 text-background">
            <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[0.8125rem] whitespace-nowrap [scrollbar-width:none]" data-testid="snippet">
              {SNIPPET}
            </code>
            <CopyButton text={SNIPPET} label="Copy" testId="copy-snippet" />
          </div>
        </div>
      </div>
    </section>
  );
}
