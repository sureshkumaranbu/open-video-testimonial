import type { PublicTestimonial } from "@/lib/testimonials";
import { Icon } from "./Icon";

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

/** Read-only card used by the wall of love and the iframe embed. */
export function TestimonialCard({ t, video }: { t: PublicTestimonial; video?: VideoOptions }) {
  const byline = [t.title, t.company].filter(Boolean).join(", ");
  return (
    <article className={t.video ? "testimonial" : "testimonial text-only"}>
      {t.video && (
        <div className="media">
          <video
            controls
            preload={video?.preload ?? "metadata"}
            playsInline
            muted={video?.muted}
            poster={video?.poster}
          >
            <source src={t.video.url} type={t.video.mime} />
            {video?.fallback && <source src={video.fallback.url} type={video.fallback.mime} />}
          </video>
        </div>
      )}
      {t.rating ? <Stars rating={t.rating} /> : null}
      {t.text && <p className="quote">{t.text}</p>}
      <div className="author">
        <Avatar name={t.name} url={t.avatarUrl} />
        <div>
          <strong>{t.name}</strong>
          {byline && <div className="byline">{byline}</div>}
        </div>
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
