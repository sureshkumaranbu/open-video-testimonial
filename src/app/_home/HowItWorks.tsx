import { CheckIcon, CopyIcon, LinkIcon } from "lucide-react";
import { Face } from "./bits";
import { STEPS } from "./content";
import { byId, PEOPLE } from "./samples";

const STAR = "M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z";

function Line({ w }: { w: string }) {
  return <span aria-hidden className="block h-2 rounded-full bg-foreground/12" style={{ width: w }} />;
}

/** Share: the project link is copied, then the customer's page fills in its stars. */
function AskVignette() {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2 rounded-full bg-card px-3 py-2 text-xs font-medium shadow-tile">
        <LinkIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">yoursite.com/c/acme</span>
        <span className="relative ml-auto grid size-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <CopyIcon aria-hidden className="vg-copy-a size-3" />
          <CheckIcon aria-hidden className="vg-copy-b absolute size-3" strokeWidth={3} />
        </span>
      </div>
      <div className="vg-rise flex flex-1 flex-col gap-3 rounded-lg bg-card p-4 shadow-tile" style={{ ["--d" as string]: "600ms" }}>
        <span className="flex items-center gap-2.5 text-sm font-semibold">
          <Face person={PEOPLE.grace} size={32} />
          Hi Grace, how did we do?
        </span>
        <span className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <svg key={n} aria-hidden viewBox="0 0 24 24" className="vg-star size-5 fill-star" style={{ ["--n" as string]: n }}>
              <path d={STAR} />
            </svg>
          ))}
        </span>
        <Line w="88%" />
        <Line w="62%" />
        <span className="mt-auto inline-flex items-center gap-2 self-start rounded-full bg-foreground px-3 py-1.5 text-xs font-bold text-background">
          <span className="vg-pulse size-2 rounded-full bg-[#ff4d3d]" />
          Record a video
        </span>
      </div>
    </div>
  );
}

/** Approve: the queue, where Ken's pending testimonial turns approved. */
function ApproveVignette() {
  const rows = [
    { p: PEOPLE.grace, from: "Approved", to: null },
    { p: PEOPLE.ken, from: "Pending", to: "Approved" },
    { p: PEOPLE.leila, from: "Pending", to: null },
  ] as const;
  return (
    <ul className="flex h-full flex-col justify-center gap-2.5">
      {rows.map(({ p, from, to }, i) => (
        <li
          key={p.id}
          className={`vg-rise flex items-center gap-3 rounded-lg bg-card p-3 shadow-tile ${to ? "vg-row-focus" : ""}`}
          style={{ ["--d" as string]: `${i * 120}ms` }}
        >
          <Face person={p} size={32} />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <strong className="text-sm leading-none">{p.name}</strong>
            <Line w="80%" />
          </span>
          <span className="relative grid shrink-0 text-xs font-bold">
            {to ? (
              <>
                <span className="vg-badge-from col-start-1 row-start-1 rounded-full bg-tint-4 px-2.5 py-1 text-foreground">{from}</span>
                <span className="vg-badge-to col-start-1 row-start-1 inline-flex items-center gap-1 rounded-full bg-tint-2 px-2.5 py-1 text-foreground">
                  <CheckIcon aria-hidden className="size-3" strokeWidth={3} />
                  {to}
                </span>
              </>
            ) : (
              <span className={`rounded-full px-2.5 py-1 text-foreground ${from === "Approved" ? "bg-tint-2" : "bg-tint-4"}`}>{from}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Show: one line of code, and the wall appears on "your site". */
function ShowVignette() {
  const maya = byId("maya");
  const daniel = byId("daniel");
  return (
    <div className="flex h-full flex-col gap-3">
      <code className="block truncate rounded-full bg-foreground px-3.5 py-2 font-mono text-[0.72rem] text-background">
        &lt;script src=&quot;…/widget.js&quot; data-widget=&quot;…&quot;&gt;
      </code>
      <div className="grid flex-1 grid-cols-2 gap-2 rounded-lg bg-card p-2.5 shadow-tile">
        {[maya, daniel].map((v, i) => (
          <span
            key={v.id}
            className="vg-rise relative block overflow-hidden rounded-md bg-muted"
            style={{ ["--d" as string]: `${500 + i * 140}ms` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={v.poster} alt="" width={v.width} height={v.height} loading="lazy" decoding="async" className="aspect-[16/9] h-auto w-full object-cover" />
          </span>
        ))}
        {[PEOPLE.theo, PEOPLE.jordan].map((p, i) => (
          <span
            key={p.id}
            className="vg-rise flex flex-col gap-1.5 rounded-md bg-tint-5 p-2"
            style={{ ["--d" as string]: `${780 + i * 140}ms` }}
          >
            <Face person={p} size={22} />
            <Line w="90%" />
            <Line w="60%" />
          </span>
        ))}
      </div>
    </div>
  );
}

const VIGNETTES = { ask: AskVignette, approve: ApproveVignette, show: ShowVignette } as const;
const VIGNETTE_BG = { ask: "bg-tint-1", approve: "bg-tint-2", show: "bg-tint-5" } as const;

export function HowItWorks() {
  return (
    <section id="how" data-testid="section-how" aria-labelledby="how-title" className="mx-auto max-w-[82.5rem] px-4 py-20 sm:px-5 md:py-28">
      <div className="max-w-[44rem]">
        <h2 id="how-title" className="font-display text-[clamp(2.25rem,1.6rem+2.6vw,3.5rem)] leading-[1] font-extrabold tracking-display text-balance">
          Ask. Approve. Show.
        </h2>
        <p className="mt-5 max-w-[56ch] text-lg text-muted-foreground">
          Three steps from the first link to testimonials on your site, with nothing for your customers to install.
        </p>
      </div>
      <ol className="mt-12 grid gap-5 md:grid-cols-3" data-testid="how-it-works">
        {STEPS.map((s, i) => {
          const Vignette = VIGNETTES[s.key];
          return (
            <li key={s.key} data-step={s.key} className="flex flex-col">
              <div
                data-reveal
                data-testid={`vignette-${s.key}`}
                aria-hidden
                className={`vignette h-72 rounded-xl p-5 ${VIGNETTE_BG[s.key]}`}
              >
                <Vignette />
              </div>
              <h3 className="mt-6 flex items-center gap-3 font-display text-2xl font-bold tracking-tight">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-sm text-background">{i + 1}</span>
                {s.title}
              </h3>
              <p className="mt-3 max-w-[48ch] text-muted-foreground">{s.body}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
