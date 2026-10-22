"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Face } from "./Face";
import { byId, type SampleVideoTestimonial } from "./samples";

// The person who records in the demo, then gets approved and goes live.
const SAMPLE = byId("daniel");

const STEPS = [
  { key: "record", label: "Recording" },
  { key: "review", label: "Review" },
  { key: "live", label: "Live on your site" },
] as const;

export const STEP_MS = 3600;

// Bar heights for the animated voice waveform.
const WAVE = [8, 14, 22, 12, 26, 18, 10, 20, 28, 16, 9, 18, 24, 12, 7, 15, 22, 11, 6, 13, 19, 9];

/**
 * The "camera" in the Recording step: the sample clip, muted and looping.
 * The poster is a plain image that paints first and keeps the box's size;
 * the video sits on top and only fades in once it's actually playing. It
 * downloads and plays only while the demo runs and the frame is in view,
 * and never with reduced motion or Save-Data, which keep the poster.
 */
function HeroClip({
  sample,
  running,
  children,
}: {
  sample: SampleVideoTestimonial;
  running: boolean;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [motion, setMotion] = useState(false);
  const [inView, setInView] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (!reduce && !saveData) setMotion(true);
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!motion || !el) return;
    if (!("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [motion]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (inView && running) {
      v.muted = true;
      void v.play().catch(() => undefined);
    } else {
      v.pause();
    }
  }, [inView, running, motion]);

  return (
    <div ref={box} className="demo-camera" data-testid="hero-clip" data-playing={playing}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sample.poster}
        alt=""
        width={sample.width}
        height={sample.height}
        fetchPriority="high"
        data-testid="hero-poster"
      />
      {motion && (
        <video
          ref={video}
          muted
          loop
          playsInline
          preload="none"
          width={sample.width}
          height={sample.height}
          aria-hidden
          tabIndex={-1}
          onPlaying={() => setPlaying(true)}
        >
          {sample.sources.map((s) => (
            <source key={s.src} src={s.src} type={s.type} />
          ))}
        </video>
      )}
      {children}
    </div>
  );
}

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
            <HeroClip sample={SAMPLE} running={!paused}>
              <span className="rec-pill live" data-testid="demo-rec">
                REC 00:{String(seconds % 60).padStart(2, "0")}
              </span>
              <span className="demo-subtitle">&ldquo;We set it up on Friday and had six videos by Monday.&rdquo;</span>
            </HeroClip>
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
                <Face person={SAMPLE} size={34} className="demo-avatar" eager />
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
                    <Face person={SAMPLE} size={24} className="demo-avatar" eager />
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
