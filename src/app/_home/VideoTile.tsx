"use client";

import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SampleTag } from "./bits";
import type { SampleVideoTestimonial } from "./samples";

type State = "idle" | "preview" | "playing" | "paused" | "ended";

/**
 * A video testimonial tile. It shows the poster (an <img> with its size set,
 * so nothing shifts) and loads no video until the visitor asks:
 * - on a device with a precise pointer, hovering plays a muted preview;
 * - a click (or Enter/Space) plays it inline from the start with sound and
 *   captions when the clip has them, and the same button then pauses.
 * With reduced motion there's no hover preview; a click still plays.
 */
export function VideoTile({
  video,
  shape,
  focus,
  eager = false,
}: {
  video: SampleVideoTestimonial & { captions?: string };
  shape: "tall" | "square";
  focus: string;
  eager?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [armed, setArmed] = useState(false);
  const [state, setState] = useState<State>("idle");
  const hoverable = useRef(false);
  const label = `${video.name}'s sample video testimonial`;

  useEffect(() => {
    hoverable.current =
      window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Runs after the <video> exists (it's only rendered once armed).
  const pending = useRef<null | "preview" | "play">(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || !pending.current) return;
    const want = pending.current;
    pending.current = null;
    if (want === "preview") startPreview(v);
    else startPlay(v);
  });

  function startPreview(v: HTMLVideoElement) {
    v.muted = true;
    v.loop = true;
    void v.play().then(
      () => setState((s) => (s === "idle" || s === "preview" ? "preview" : s)),
      () => undefined,
    );
  }

  function startPlay(v: HTMLVideoElement) {
    v.loop = false;
    v.muted = false;
    if (state === "idle" || state === "preview" || state === "ended") v.currentTime = 0;
    for (const t of Array.from(v.textTracks)) t.mode = "showing";
    setState("playing");
    void v.play().catch(() => {
      // Autoplay rules can refuse sound; fall back to a muted start.
      v.muted = true;
      void v.play().catch(() => setState("paused"));
    });
  }

  function onEnter() {
    if (!hoverable.current || state !== "idle") return;
    if (!armed) {
      pending.current = "preview";
      setArmed(true);
    } else if (ref.current) startPreview(ref.current);
  }

  function onLeave() {
    const v = ref.current;
    if (state !== "preview" || !v) return;
    v.pause();
    setState("idle");
  }

  function onClick() {
    const v = ref.current;
    if (state === "playing") {
      v?.pause();
      setState("paused");
      return;
    }
    if (!armed || !v) {
      pending.current = "play";
      setArmed(true);
      return;
    }
    startPlay(v);
  }

  const showVideo = state !== "idle";
  const action = state === "playing" ? "Pause" : state === "ended" ? "Replay" : "Play";

  return (
    <figure
      data-testid="video-tile"
      data-state={state}
      data-sample-card
      className={cn(
        "group/vt relative m-0 overflow-hidden rounded-xl bg-muted shadow-tile",
        shape === "tall" ? "aspect-square sm:aspect-[4/5]" : "aspect-square",
      )}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={video.poster}
        alt=""
        width={video.width}
        height={video.height}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        data-testid="video-poster"
        className="absolute inset-0 size-full object-cover"
        style={{ objectPosition: focus }}
      />
      {armed && (
        <video
          ref={ref}
          poster={video.poster}
          preload="none"
          muted
          playsInline
          width={video.width}
          height={video.height}
          aria-label={label}
          onEnded={() => setState("ended")}
          onPause={() => setState((s) => (s === "playing" ? "paused" : s))}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-500 ease-out",
            showVideo ? "opacity-100" : "opacity-0",
          )}
          style={{ objectPosition: focus }}
        >
          {video.sources.map((s) => (
            <source key={s.src} src={s.src} type={s.type} />
          ))}
          {video.captions && <track kind="captions" src={video.captions} srcLang="en" label="English" default />}
        </video>
      )}

      <button
        type="button"
        onClick={onClick}
        aria-label={`${action} ${label}`}
        className="absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-ring"
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-3.5 left-3.5 grid size-12 place-items-center rounded-full bg-white text-[#1b1530] shadow-tile",
            "transition-[scale,opacity] duration-300 ease-out motion-safe:group-hover/vt:scale-110",
            state === "preview" && "opacity-90",
          )}
        >
          {state === "playing" ? (
            <PauseIcon className="size-5 fill-current" />
          ) : state === "ended" ? (
            <RotateCcwIcon className="size-5" />
          ) : (
            <PlayIcon className="ml-0.5 size-5 fill-current" />
          )}
        </span>
      </button>

      <SampleTag className="absolute top-4 right-4 z-10 bg-white/90 text-[#1b1530]" />

      <figcaption className="pointer-events-none absolute inset-x-2.5 bottom-2.5 z-10 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 rounded-lg bg-white/95 px-3.5 py-2.5 text-sm text-[#1b1530]">
        <span>
          <strong className="font-bold">{video.name}</strong> · {video.role}
        </span>
        {(state === "playing" || state === "paused") && !video.captions && (
          <span className="shrink-0 text-xs text-[#595270]">No sound in this sample</span>
        )}
      </figcaption>
    </figure>
  );
}
