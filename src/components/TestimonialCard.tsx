import type { PublicTestimonial } from "@/lib/testimonials";
import { Icon } from "./Icon";
import { PlatformIcon } from "./PlatformIcon";

export function Stars({ rating, label }: { rating: number; label?: string }) {
  return (
    <span className="stars" role="img" aria-label={label ?? `${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= rating ? undefined : "off"} aria-hidden>
          <Icon name="star" />
        </span>
      ))}
    </span>
  );
}

export function Avatar({ name, url }: { name: string; url: string | null }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (url) return <img className="avatar" src={url} alt="" loading="lazy" />;
  return (
    <span className="avatar" aria-hidden>
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

type VideoOptions = {
  /** Poster image shown before playback. */
  poster?: string;
  preload?: "none" | "metadata";
  muted?: boolean;
  /** Extra source tried after t.video, e.g. an MP4 fallback for a WebM clip. */
  fallback?: { url: string; mime: string };
};

/** Frame ratio for a video: its own shape, clamped between 3:4 and 16:9. */
export function videoRatio(v: { width: number | null; height: number | null }) {
  if (!v.width || !v.height) return "16 / 10";
  return String(Math.min(Math.max(v.width / v.height, 0.75), 1.78));
}

/**
 * Which parts of a card a wall shows (the DISP-03 toggles). Leaving it out
 * draws the card exactly as the legacy wall and the iframe embed always have.
 */
export type CardDisplay = {
  showRating: boolean;
  showVideo: boolean;
  showImages: boolean;
  showAvatar: boolean;
  showTitle: boolean;
  showHeadline: boolean;
  showSource: boolean;
  showVerified: boolean;
  date: "absolute" | "relative" | "hidden";
};

/** The display extras a wall's feed items carry (FeedItem["extra"], structurally). */
type CardExtra = {
  headline: string | null;
  date: string;
  datePrecision: "day" | "month" | "year";
  platform: string | null;
  sourceUrl: string | null;
  verified: boolean;
  images: { url: string; alt: string | null }[];
};

function cardDate(iso: string, precision: CardExtra["datePrecision"], mode: CardDisplay["date"]) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || mode === "hidden") return "";
  if (mode === "relative") {
    const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
    if (days < 1) return "Today";
    if (days < 31) return `${days} ${days === 1 ? "day" : "days"} ago`;
    const months = Math.floor(days / 30.4);
    if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
    const years = Math.floor(days / 365.25);
    return `${years} ${years === 1 ? "year" : "years"} ago`;
  }
  const opts: Intl.DateTimeFormatOptions =
    precision === "year" ? { year: "numeric" } : precision === "month" ? { month: "short", year: "numeric" } : { day: "numeric", month: "short", year: "numeric" };
  return d.toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}

/** Read-only card used by the wall of love and the iframe embed. */
export function TestimonialCard({
  t,
  video,
  display,
}: {
  t: PublicTestimonial & { extra?: CardExtra };
  video?: VideoOptions;
  /** Walls only: which parts to show. */
  display?: CardDisplay;
}) {
  const show = (k: Exclude<keyof CardDisplay, "date">) => !display || display[k];
  const byline = show("showTitle") ? [t.title, t.company].filter(Boolean).join(", ") : "";
  const poster = video?.poster ?? t.video?.poster ?? undefined;
  const clip = show("showVideo") ? t.video : null;
  const extra = display ? t.extra : undefined;
  const date = extra ? cardDate(extra.date, extra.datePrecision, display!.date) : "";
  const source = extra && display!.showSource && extra.sourceUrl ? extra.sourceUrl : null;
  return (
    <article className={clip ? "testimonial" : "testimonial text-only"} data-testimonial-id={display ? t.id : undefined}>
      {clip && (
        <div className="media">
          <video
            controls
            preload={video?.preload ?? (poster ? "none" : "metadata")}
            playsInline
            muted={video?.muted}
            poster={poster}
            style={{ aspectRatio: videoRatio(clip) }}
          >
            {clip.sources.length ? (
              clip.sources.map((src) => <source key={src.url} src={src.url} type={src.type} />)
            ) : (
              <source src={clip.url} type={clip.mime} />
            )}
            {video?.fallback && <source src={video.fallback.url} type={video.fallback.mime} />}
            {clip.captionsUrl && <track kind="captions" src={clip.captionsUrl} label="Captions" default />}
          </video>
          {clip.transcript && (
            <details className="transcript">
              <summary>Transcript</summary>
              <p>{clip.transcript}</p>
            </details>
          )}
        </div>
      )}
      {t.rating && show("showRating") ? <Stars rating={t.rating} /> : null}
      {extra && display!.showHeadline && extra.headline && <h3 className="headline">{extra.headline}</h3>}
      {t.text && <p className="quote">{t.text}</p>}
      {extra && display!.showImages && extra.images.length > 0 && (
        <div className="card-images">
          {extra.images.slice(0, 3).map((i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i.url} src={i.url} alt={i.alt ?? ""} loading="lazy" />
          ))}
        </div>
      )}
      <div className="author">
        {show("showAvatar") && <Avatar name={t.name} url={t.avatarUrl} />}
        <div>
          <strong>{t.name}</strong>
          {byline && <div className="byline">{byline}</div>}
          {(date || (extra && display!.showVerified && extra.verified)) && (
            <div className="byline">
              {date && <time dateTime={extra!.date}>{date}</time>}
              {date && display!.showVerified && extra!.verified ? " · " : null}
              {display?.showVerified && extra?.verified ? "Verified" : null}
            </div>
          )}
        </div>
        {source && (
          <a className="card-source" href={source} rel="nofollow noopener noreferrer" target="_blank">
            {extra!.platform ? <PlatformIcon platform={extra!.platform} label={extra!.platform} /> : "Source"}
          </a>
        )}
      </div>
    </article>
  );
}

export function TestimonialGrid({ items }: { items: PublicTestimonial[] }) {
  if (items.length === 0) {
    return (
      <div className="empty">
        <Icon name="inbox" />
        <p>No testimonials here yet.</p>
      </div>
    );
  }
  return (
    <div className="wall">
      {items.map((t) => (
        <TestimonialCard key={t.id} t={t} />
      ))}
    </div>
  );
}
