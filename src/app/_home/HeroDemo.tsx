"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { SAMPLE_VIDEOS } from "./samples";

const SAMPLE = SAMPLE_VIDEOS[0];

const STEPS = [
  { key: "record", label: "Recording" },
  { key: "review", label: "Review" },
  { key: "live", label: "Live on your site" },
] as const;

export const STEP_MS = 3600;

// Bar heights for the animated voice waveform.
const WAVE = [8, 14, 22, 12, 26, 18, 10, 20, 28, 16, 9, 18, 24, 12, 7, 15, 22, 11, 6, 13, 19, 9];

/** Static poster of the sample clip with a play glyph (the demo is a mock). */
function DemoThumb() {
  return (
    <span className="demo-thumb" data-testid="demo-video-thumb">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={SAMPLE.poster} alt="" width={SAMPLE.width} height={SAMPLE.height} decoding="async" />
      <span className="demo-play">
        <Icon name="play" />
      </span>
    </span>
  );
}

/**
 * Auto-advancing demo of the core loop. Each step lasts STEP_MS; pausing
 * freezes both the timer and the CSS progress bar so they stay in sync.
 * Starts paused when the visitor prefers reduced motion.
 */
export function HeroDemo() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const remaining = useRef(STEP_MS);
  const startedAt = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPaused(true);
  }, []);

  // Step timer. Remaining time is only recalculated on pause, so resuming
  // continues where the progress bar stopped.
  useEffect(() => {
    if (paused) return;
    startedAt.current = performance.now();
    const timer = window.setTimeout(() => {
      remaining.current = STEP_MS;
      setStep((s) => (s + 1) % STEPS.length);
    }, remaining.current);
    return () => window.clearTimeout(timer);
  }, [paused, step]);

  // Live REC counter while recording.
  useEffect(() => {
    setSeconds(0);
    if (step !== 0 || paused) return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [step, paused]);

  function togglePause() {
    if (!paused) {
      remaining.current = Math.max(remaining.current - (performance.now() - startedAt.current), 0);
    }
    setPaused(!paused);
  }

  function goTo(i: number) {
    remaining.current = STEP_MS;
    setStep(i);
  }

  const current = STEPS[step].key;

  return (
    <figure
      className="demo stage"
      data-testid="hero-demo"
      data-step={current}
      data-paused={paused}
      aria-label="Demo: a testimonial is recorded, approved, then shown on a website"
      style={{ ["--step-ms" as string]: `${STEP_MS}ms` }}
    >
      <span className="stage-frame" aria-hidden />

      <div className="demo-top">
        <ol className="demo-steps" aria-label="Demo steps">
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                className="demo-step"
                aria-current={i === step ? "step" : undefined}
                data-done={i < step}
                onClick={() => goTo(i)}
              >
                <span className="demo-step-bar" aria-hidden>
                  <span key={i === step ? `${step}-active` : `${i}-idle`} />
                </span>
                {s.label}
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="demo-pause"
          aria-pressed={paused}
          aria-label={paused ? "Play demo" : "Pause demo"}
          onClick={togglePause}
        >
          {paused ? <Icon name="play" /> : <Icon name="pause" />}
        </button>
      </div>

      <div className="demo-screen" key={current}>
        {current === "record" && (
          <div className="demo-record">
            <span className="rec-pill live" data-testid="demo-rec">
              REC 00:{String(seconds % 60).padStart(2, "0")}
            </span>
            <blockquote>&ldquo;We set it up on Friday and had six videos by Monday.&rdquo;</blockquote>
            <div className="caption">
              <span className="wave live" aria-hidden>
                {WAVE.map((h, i) => (
                  <i key={i} style={{ height: h, animationDelay: `${(i % 7) * 90}ms` }} />
                ))}
              </span>
              Recorded in the browser
            </div>
          </div>
        )}

        {current === "review" && (
          <div className="demo-review">
            <div className="demo-card">
              <div className="demo-card-head">
                <span className="demo-avatar" aria-hidden>
                  {SAMPLE.name[0]}
                </span>
                <div>
                  <strong>{SAMPLE.name}</strong>
                  <span>
                    {SAMPLE.role}, {SAMPLE.company}
                  </span>
                </div>
                <span className="demo-badge-swap">
                  <span className="demo-badge pending">Pending</span>
                  <span className="demo-badge approved">Approved</span>
                </span>
              </div>
              <DemoThumb />
              <div className="demo-stars" aria-hidden>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Icon key={n} name="star" />
                ))}
              </div>
              <div className="demo-actions">
                <span className="demo-btn ghost">Reject</span>
                <span className="demo-btn approve">
                  <Icon name="check" />
                  Approve
                </span>
              </div>
            </div>

          </div>
        )}

        {current === "live" && (
          <div className="demo-live">
            <div className="demo-browser" aria-hidden>
              <div className="demo-browser-bar">
                <i />
                <i />
                <i />
                <span>yoursite.com</span>
              </div>
              <div className="demo-browser-body">
                <span className="line w60" />
                <span className="line w40" />
                <div className="demo-landed">
                  <DemoThumb />
                  <div className="demo-stars">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Icon key={n} name="star" />
                    ))}
                  </div>
                  <p>&ldquo;{SAMPLE.quote}&rdquo;</p>
                  <div className="demo-landed-author">
                    <span className="demo-avatar">{SAMPLE.name[0]}</span>
                    <strong>{SAMPLE.name}</strong>
                    <span className="demo-sample">Sample</span>
                  </div>
                </div>
                <span className="line w80" />
              </div>
            </div>
            <div className="caption">One snippet. Light or dark.</div>
          </div>
        )}
      </div>
    </figure>
  );
}
