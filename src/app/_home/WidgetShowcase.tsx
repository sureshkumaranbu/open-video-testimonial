"use client";

import { useState } from "react";
import { TestimonialCard } from "@/components/TestimonialCard";
import type { PublicTestimonial } from "@/lib/testimonials";

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

  return (
    <div className="showcase" data-testid="widget-showcase">
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
          {SAMPLES.map((t) => (
            <TestimonialCard key={t.id} t={t} />
          ))}
        </div>
      </div>
    </div>
  );
}
