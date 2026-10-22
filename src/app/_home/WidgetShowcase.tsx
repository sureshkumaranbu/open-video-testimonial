"use client";

import { useEffect, useRef, useState } from "react";
import { TestimonialCard } from "@/components/TestimonialCard";
import type { PublicTestimonial } from "@/lib/testimonials";
import { SAMPLE_VIDEOS } from "./samples";

const VIDEO_SAMPLE = SAMPLE_VIDEOS[1];

const SAMPLES: PublicTestimonial[] = [
  {
    id: "s1",
    name: "Sample: Amara",
    title: "Founder",
    company: "a bakery",
    avatarUrl: null,
    rating: 5,
    text: "Our regulars recorded short clips at the counter. They're now the first thing on our homepage.",
    video: null,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "s-video",
    name: `Sample: ${VIDEO_SAMPLE.name}`,
    title: VIDEO_SAMPLE.role,
    company: `${VIDEO_SAMPLE.company} (fictional)`,
    avatarUrl: null,
    rating: VIDEO_SAMPLE.rating,
    text: VIDEO_SAMPLE.quote,
    // The poster is passed separately so it can load lazily.
    video: {
      url: VIDEO_SAMPLE.sources[0].src,
      mime: VIDEO_SAMPLE.sources[0].type,
      poster: null,
      width: VIDEO_SAMPLE.width,
      height: VIDEO_SAMPLE.height,
      durationMs: null,
      sources: [],
      captionsUrl: null,
      transcript: null,
    },
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "s2",
    name: "Sample: Leo",
    title: "Coach",
    company: null,
    avatarUrl: null,
    rating: 5,
    text: "I send the link after every session. Approving takes seconds.",
    video: null,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "s3",
    name: "Sample: Mei",
    title: "Product lead",
    company: "a SaaS team",
    avatarUrl: null,
    rating: 4,
    text: "We host it ourselves, so customer emails never leave our server.",
    video: null,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

/** Live preview of the real testimonial card with theme and layout toggles. */
export function WidgetShowcase() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  // Attach the video poster only when the showcase is near the viewport.
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="showcase" data-testid="widget-showcase" ref={ref}>
      <div className="showcase-controls row">
        <div className="segmented" role="group" aria-label="Preview theme">
          {(["light", "dark"] as const).map((t) => (
            <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)}>
              {t === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Preview layout">
          {(["grid", "list"] as const).map((l) => (
            <button key={l} type="button" aria-pressed={layout === l} onClick={() => setLayout(l)}>
              {l === "grid" ? "Grid" : "List"}
            </button>
          ))}
        </div>
        <span className="muted xsmall">Sample content for illustration</span>
      </div>
      <div
        className="showcase-stage"
        data-theme={theme}
        data-layout={layout}
        data-testid="showcase-stage"
        style={{ ["--accent" as string]: "#e2463f", ["--on-accent" as string]: "#ffffff" }}
      >
        <div className={layout === "grid" ? "wall" : "showcase-list"}>
          {SAMPLES.map((t) =>
            t.video ? (
              <TestimonialCard
                key={t.id}
                t={t}
                video={{
                  poster: near ? VIDEO_SAMPLE.poster : undefined,
                  preload: "none",
                  muted: true,
                  fallback: { url: VIDEO_SAMPLE.sources[1].src, mime: VIDEO_SAMPLE.sources[1].type },
                }}
              />
            ) : (
              <TestimonialCard key={t.id} t={t} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
