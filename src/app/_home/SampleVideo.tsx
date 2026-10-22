"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { SampleVideoTestimonial } from "./samples";

/**
 * A lazy, muted, click-to-play video. Nothing loads until the card is near
 * the viewport (then only the poster), and the video itself only downloads
 * when the visitor presses play. It never autoplays and starts muted; the
 * native controls can unmute. The box is sized up front, so no layout shift.
 */
export function SampleVideo({ sample, label }: { sample: SampleVideoTestimonial; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
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

  function play() {
    setStarted(true);
    const v = video.current;
    if (!v) return;
    v.muted = true;
    void v.play().catch(() => undefined);
  }

  return (
    <div
      ref={box}
      className="sample-video"
      data-testid="sample-video"
      data-started={started}
      style={{ aspectRatio: `${sample.width} / ${sample.height}` }}
    >
      {near && (
        <video
          ref={video}
          poster={sample.poster}
          preload="none"
          muted
          playsInline
          controls={started}
          width={sample.width}
          height={sample.height}
          aria-label={label}
        >
          {sample.sources.map((s) => (
            <source key={s.src} src={s.src} type={s.type} />
          ))}
        </video>
      )}
      {!started && (
        <button type="button" className="sample-play" onClick={play} aria-label={`Play ${label}`}>
          <Icon name="play" />
        </button>
      )}
    </div>
  );
}
