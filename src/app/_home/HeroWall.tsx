import { ArrowRightIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Face, GitHubMark, SampleTag, Stars } from "./bits";
import { DASHBOARD, HEADLINE, LEDE, REPO, WALL, type Tint } from "./content";
import { CREDITS_URL, SAMPLE_DISCLAIMER } from "./samples";
import { VideoTile } from "./VideoTile";

const TINT: Record<Tint, string> = {
  1: "bg-tint-1",
  2: "bg-tint-2",
  3: "bg-tint-3",
  4: "bg-tint-4",
  5: "bg-tint-5",
};

/**
 * The top of the page is the product: a wall of love. The headline and the
 * call to action are its first tile (first on a phone too); the tiles rise in
 * once, staggered (home.css `.wall-tile`), and that's the page's one
 * entrance moment.
 */
export function HeroWall() {
  return (
    <section
      id="top"
      data-testid="section-hero"
      aria-labelledby="hero-title"
      className="mx-auto max-w-[82.5rem] px-4 pt-2 pb-16 sm:px-5 md:pb-24"
    >
      <div className="wall" data-testid="hero-wall">
        <div
          className="wall-tile hero-tile flex flex-col rounded-xl bg-primary p-7 text-primary-foreground sm:p-9"
          style={{ ["--i" as string]: 0 }}
          data-testid="hero-tile"
        >
          <h1
            id="hero-title"
            className="hero-title font-display leading-display font-extrabold tracking-display text-balance"
          >
            {HEADLINE}
          </h1>
          <p className="mt-5 text-lg text-pretty">{LEDE}</p>
          <div className="mt-7 flex flex-wrap gap-2.5">
            <Button asChild variant="onPrimary" size="lg">
              <a href={DASHBOARD}>
                Start your wall
                <ArrowRightIcon aria-hidden className="transition-[translate] duration-300 ease-out motion-safe:group-hover:translate-x-0.5" />
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              className="border-[1.5px] border-primary-foreground/45 bg-transparent text-primary-foreground hover:border-primary-foreground"
            >
              <a href={REPO}>
                <GitHubMark />
                View on GitHub
              </a>
            </Button>
          </div>
          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
            {["MIT licensed", "One Docker container", "Your server, your data"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <CheckIcon aria-hidden className="size-4" strokeWidth={3} />
                {t}
              </li>
            ))}
          </ul>
        </div>

        {WALL.map((tile, i) =>
          tile.kind === "video" ? (
            <div
              key={`v-${tile.video.id}`}
              className={cn("wall-tile", tile.phone === false && "max-sm:hidden")}
              style={{ ["--i" as string]: i + 1 }}
            >
              <VideoTile video={tile.video} shape={tile.shape} focus={tile.focus} eager={i < 2} />
            </div>
          ) : (
            <figure
              key={`t-${tile.person.id}`}
              data-testid="text-tile"
              data-sample-card
              className={cn(
                "wall-tile quote-tile relative m-0 rounded-xl p-6 text-foreground",
                TINT[tile.tint],
                tile.phone === false && "max-sm:hidden",
              )}
              style={{ ["--i" as string]: i + 1 }}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <Stars rating={tile.rating} />
                <SampleTag />
              </div>
              <blockquote
                className={cn(
                  "m-0 leading-snug font-medium tracking-tight text-pretty",
                  tile.big ? "text-[1.625rem]" : "text-xl",
                )}
              >
                {tile.text}
              </blockquote>
              <figcaption className="mt-5 flex items-center gap-3 text-sm">
                <Face person={tile.person} size={40} className="ring-2 ring-background" />
                <span className="leading-tight">
                  <strong className="block font-bold">{tile.person.name}</strong>
                  <span className="text-muted-foreground">
                    {tile.person.role}, {tile.person.company}
                  </span>
                </span>
              </figcaption>
            </figure>
          ),
        )}
      </div>
      <p className="mx-auto mt-6 max-w-[70ch] text-center text-xs text-muted-foreground" data-testid="sample-caption">
        {SAMPLE_DISCLAIMER}{" "}
        <a href={CREDITS_URL} className="link-grow font-semibold text-foreground">
          Credits
        </a>
      </p>
    </section>
  );
}
