"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { formFrameUrl, readFormMessage } from "./embed.js";

export type PlauditFormProps = {
  /** Your Plaudit server, e.g. "https://plaudit.example.com". */
  server: string;
  /** The project's slug. */
  project: string;
  /** The form's slug (Forms › your form › Share). */
  form: string;
  /** Prefilled and hidden fields passed to the form, such as name or utm_source. */
  params?: Record<string, string | number | undefined>;
  /** The frame's accessible name. */
  title?: string;
  /** Height before the form reports its own (px). */
  minHeight?: number;
  /** Grow the frame to fit each step (default on). */
  autoResize?: boolean;
  /** Called once a testimonial is sent. */
  onSubmitted?: () => void;
  className?: string;
  style?: CSSProperties;
};

/**
 * A Plaudit collection form, embedded as an iframe so your site's CSS can't
 * break it and it may use the camera. It renders the same on the server and
 * in the browser; there, it listens for the form's own messages to grow with
 * each step and to say when it was sent.
 */
export function PlauditForm({ server, project, form, params, title = "Share your experience", minHeight = 640, autoResize = true, onSubmitted, className, style }: PlauditFormProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const submitted = useRef(onSubmitted);
  submitted.current = onSubmitted;
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const m = readFormMessage(e, server, form);
      if (m?.type === "plaudit:form-resize" && autoResize) setHeight(m.height);
      if (m?.type === "plaudit:form-submitted") submitted.current?.();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [server, form, autoResize]);
  const src = formFrameUrl(server, project, form, params);
  if (!src) return null;
  return (
    <iframe
      ref={frame}
      src={src}
      title={title}
      allow="camera; microphone; clipboard-write"
      className={className}
      style={{ width: "100%", border: 0, minHeight, ...(height ? { height } : {}), ...style }}
    />
  );
}
