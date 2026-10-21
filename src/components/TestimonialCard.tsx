import type { PublicTestimonial } from "@/lib/testimonials";

export function Stars({ rating }: { rating: number }) {
  return (
    <span className="stars" aria-label={`${rating} out of 5 stars`}>
      {"★".repeat(rating)}
      <span style={{ opacity: 0.25 }}>{"★".repeat(5 - rating)}</span>
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

/** Read-only card used by the wall of love and the iframe embed. */
export function TestimonialCard({ t }: { t: PublicTestimonial }) {
  const byline = [t.title, t.company].filter(Boolean).join(", ");
  return (
    <article className="card testimonial">
      {t.video && (
        <video controls preload="metadata" playsInline>
          <source src={t.video.url} type={t.video.mime} />
        </video>
      )}
      {t.rating ? <Stars rating={t.rating} /> : null}
      {t.text && <p>{t.text}</p>}
      <div className="author">
        <Avatar name={t.name} url={t.avatarUrl} />
        <div>
          <strong>{t.name}</strong>
          {byline && <div className="muted small">{byline}</div>}
        </div>
      </div>
    </article>
  );
}

export function TestimonialGrid({ items }: { items: PublicTestimonial[] }) {
  if (items.length === 0) {
    return <p className="muted">No testimonials yet.</p>;
  }
  return (
    <div className="wall">
      {items.map((t) => (
        <TestimonialCard key={t.id} t={t} />
      ))}
    </div>
  );
}
