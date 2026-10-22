"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";

const STEPS = [
  {
    key: "ask",
    title: "Ask",
    body: "Create a project and share its link after a purchase, a call or a launch. Customers rate you, then write a few lines or record a short video on any phone or laptop. Nothing to install.",
  },
  {
    key: "approve",
    title: "Approve",
    body: "Everything lands in a review queue first. Approve the keepers, reject the rest, tidy up a name and tag them by page or product. Nothing goes public without you.",
  },
  {
    key: "show",
    title: "Show",
    body: "Paste one script tag or an iframe into your site, or share your wall of love. It inherits nothing from your CSS and ships in light and dark.",
  },
] as const;

/**
 * "How it works": a sticky visual on the left that follows whichever step
 * is in the middle of the viewport on the right.
 */
export function StickySteps() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  // The active step is the one whose centre is closest to the viewport's
  // centre. Computed on scroll (rAF-throttled) so fast scrolls and jumps to
  // an anchor never leave the visual on a stale step.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const mid = window.innerHeight / 2;
      let best = 0;
      let bestDist = Infinity;
      refs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dist = Math.abs(r.top + r.height / 2 - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      setActive(best);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const key = STEPS[active].key;

  return (
    <div className="how" data-testid="how-it-works" data-active={key}>
      <div className="how-visual" aria-hidden>
        <div className="how-frame">
          <div className={`how-pane ask${key === "ask" ? " on" : ""}`}>
            <span className="how-label">yoursite.com/c/acme</span>
            <strong>How did we do?</strong>
            <span className="how-stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <Icon key={n} name="star" />
              ))}
            </span>
            <span className="how-field" />
            <span className="how-field short" />
            <span className="how-record">
              <i /> Record a video
            </span>
          </div>
          <div className={`how-pane approve${key === "approve" ? " on" : ""}`}>
            {["Approved", "Pending", "Pending"].map((s, i) => (
              <div className="how-row" key={i} style={{ ["--i" as string]: i }}>
                <span className="how-dot" />
                <span className="how-field" />
                <span className={`demo-badge ${s.toLowerCase()}`}>{s}</span>
              </div>
            ))}
          </div>
          <div className={`how-pane show${key === "show" ? " on" : ""}`}>
            <code>&lt;script src=&quot;…/widget.js&quot; data-project=&quot;acme&quot;&gt;</code>
            <div className="how-tiles">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} style={{ ["--i" as string]: i }} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <ol className="how-steps">
        {STEPS.map((s, i) => (
          <li
            key={s.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            data-index={i}
            data-step={s.key}
            className={i === active ? "on" : undefined}
          >
            <span className="step-n">0{i + 1}</span>
            <h3>{s.title}</h3>
            <p className="muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
