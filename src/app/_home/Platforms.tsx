import { PLATFORMS } from "./content";

/**
 * The platforms, drifting by. Hovering or focusing the row pauses it; with
 * reduced motion it's a still, wrapped list (home.css `.marquee`).
 */
export function Platforms() {
  return (
    <section data-testid="section-platforms" aria-labelledby="platforms-title" className="border-y border-border py-10">
      <h2 id="platforms-title" className="px-4 text-center text-sm font-semibold text-muted-foreground">
        Works wherever you can paste HTML
      </h2>
      <div className="marquee mt-6" data-testid="platform-marquee" tabIndex={0} role="region" aria-label="Supported platforms (hover or focus to pause)">
        <div className="marquee-track">
          {[0, 1].map((copy) => (
            <ul key={copy} className="marquee-set" aria-hidden={copy === 1 ? true : undefined}>
              {PLATFORMS.map((p) => (
                <li
                  key={p}
                  className="font-display text-[clamp(1.5rem,1.2rem+1.2vw,2.25rem)] font-bold tracking-tight whitespace-nowrap"
                >
                  {p}
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}
