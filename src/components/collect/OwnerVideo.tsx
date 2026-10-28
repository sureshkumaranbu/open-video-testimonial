"use client";

import type { OwnerVideo as OwnerVideoData } from "@/lib/video/form-videos";

/**
 * FORM-17: the owner's own video on the welcome or thank-you page. The MP4
 * first, the original as a fallback, captions on by default once there are
 * some. It never plays by itself.
 */
export function OwnerVideo({ video, label }: { video: OwnerVideoData; label: string }) {
  const tall = (video.height ?? 0) > (video.width ?? 0);
  return (
    <figure className={`fr-owner-video${tall ? " fr-owner-video-tall" : ""}`} data-testid="owner-video">
      <video controls playsInline preload="metadata" poster={video.poster ?? undefined} aria-label={label}>
        {video.sources.map((s) => (
          <source key={s.url} src={s.url} type={s.type} />
        ))}
        {video.captionsUrl && <track kind="captions" src={video.captionsUrl} default label="Captions" />}
      </video>
    </figure>
  );
}
