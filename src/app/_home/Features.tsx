import { CheckIcon, EyeOffIcon, InfinityIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Face } from "./bits";
import { FEATURES } from "./content";
import { byId, PEOPLE } from "./samples";

function Tile({ k, className, children, dark }: { k: keyof typeof FEATURES; className?: string; children?: React.ReactNode; dark?: boolean }) {
  const f = FEATURES[k];
  return (
    <article
      data-testid="feature-tile"
      data-feature={k}
      className={cn("feature-tile relative flex flex-col overflow-hidden rounded-xl p-6 sm:p-7", className)}
    >
      {children}
      <h3 className="mt-auto font-display text-xl font-bold tracking-tight">{f.title}</h3>
      <p className={cn("mt-2 max-w-[42ch]", dark ? "opacity-80" : "text-muted-foreground")}>{f.body}</p>
    </article>
  );
}

/** Features as a bento: one big recording tile, then tiles whose size follows what they show. */
export function Features() {
  const maya = byId("maya");
  return (
    <section id="features" data-testid="section-features" aria-labelledby="features-title" className="mx-auto max-w-[82.5rem] px-4 py-20 sm:px-5 md:py-28">
      <h2 id="features-title" className="max-w-[18ch] font-display text-[clamp(2.25rem,1.6rem+2.6vw,3.5rem)] leading-[1] font-extrabold tracking-display text-balance">
        Built for the whole loop.
      </h2>
      <div className="mt-12 grid auto-rows-[minmax(15rem,auto)] gap-4 md:grid-cols-2 lg:grid-cols-4" data-testid="bento">
        <Tile k="record" className="bg-tint-3 md:col-span-2 lg:row-span-2">
          <div className="relative mb-6 overflow-hidden rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={maya.poster}
              alt=""
              width={maya.width}
              height={maya.height}
              loading="lazy"
              decoding="async"
              className="aspect-[16/10] h-auto w-full object-cover"
            />
            <span className="absolute top-3 left-3 inline-flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 font-mono text-xs font-bold text-white">
              <span className="rec-dot size-2 rounded-full bg-[#ff4d3d]" aria-hidden />
              REC 00:18
            </span>
            <span className="absolute inset-x-3 bottom-3 flex items-end gap-1" aria-hidden>
              {[8, 16, 24, 12, 20, 28, 14, 22, 10, 18, 26, 12, 16, 9].map((h, i) => (
                <i key={i} className="wave-bar block w-1.5 rounded-full bg-white/90" style={{ height: h, ["--i" as string]: i }} />
              ))}
            </span>
          </div>
        </Tile>

        <Tile k="queue" className="bg-card ring-1 ring-border lg:col-span-2">
          <ul className="mb-6 flex flex-col gap-2" aria-hidden>
            {(
              [
                [PEOPLE.grace, "Approved", "bg-tint-2"],
                [PEOPLE.ken, "Pending", "bg-tint-4"],
              ] as const
            ).map(([p, s, bg]) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg bg-background px-3 py-2">
                <Face person={p} size={28} />
                <span className="text-sm font-semibold">{p.name}</span>
                <span className="block h-2 flex-1 rounded-full bg-foreground/10" />
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", bg)}>{s}</span>
              </li>
            ))}
          </ul>
        </Tile>

        <Tile k="wall" className="bg-tint-1">
          <div className="mb-6 flex -space-x-3" aria-hidden>
            {[PEOPLE.maya, PEOPLE.daniel, PEOPLE.grace, PEOPLE.theo, PEOPLE.leila].map((p) => (
              <Face key={p.id} person={p} size={44} className="ring-3 ring-tint-1" />
            ))}
          </div>
        </Tile>

        <Tile k="embed" className="bg-card ring-1 ring-border">
          <div className="mb-6 grid grid-cols-2 gap-2" aria-hidden>
            <span className="flex h-14 flex-col justify-center gap-1.5 rounded-lg bg-white px-3 ring-1 ring-black/10">
              <span className="block h-1.5 w-4/5 rounded-full bg-black/25" />
              <span className="block h-1.5 w-1/2 rounded-full bg-black/15" />
            </span>
            <span className="flex h-14 flex-col justify-center gap-1.5 rounded-lg bg-[#171b2b] px-3">
              <span className="block h-1.5 w-4/5 rounded-full bg-white/50" />
              <span className="block h-1.5 w-1/2 rounded-full bg-white/25" />
            </span>
          </div>
        </Tile>

        <Tile k="tracking" dark className="bg-foreground text-background md:col-span-1 lg:col-span-2">
          <EyeOffIcon aria-hidden className="mb-6 size-9" strokeWidth={1.75} />
        </Tile>

        <Tile k="unlimited" className="bg-tint-4 md:col-span-2">
          <div className="mb-6 flex items-center gap-3" aria-hidden>
            <InfinityIcon className="size-9" strokeWidth={1.75} />
            <span className="flex items-center gap-1.5 rounded-full bg-background/70 px-3 py-1.5 text-sm font-semibold">
              <CheckIcon className="size-4" strokeWidth={3} />
              No plan limits
            </span>
          </div>
        </Tile>
      </div>
    </section>
  );
}
