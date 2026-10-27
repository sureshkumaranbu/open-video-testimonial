import "../testimonial-page.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Stars, videoRatio } from "@/components/TestimonialCard";
import { env } from "@/lib/env";
import { featureOn } from "@/lib/features";
import { jsonLdText } from "@/lib/seo";
import { mediaUrl } from "@/lib/storage";
import { quoteOf, shareLinks, testimonialJsonLd, testimonialMetadata, testimonialPage } from "@/lib/testimonial-page";
import { accentStyle } from "@/lib/theme";
import { CopyLink, TestimonialBeacon } from "../TestimonialPageClient";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** Walls on (D20) and the testimonial public; anything else is a plain 404. */
function load(id: string) {
  return featureOn("walls") ? testimonialPage(id) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = load((await params).id);
  if (!d) return { metadataBase: new URL(env.publicUrl), title: "Not found", robots: { index: false } };
  return testimonialMetadata(d);
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** Text with its highlighted phrases as <mark>. */
function Highlighted({ text, marks }: { text: string; marks: { start: number; end: number }[] }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const h of marks) {
    if (h.start < at) continue;
    parts.push(text.slice(at, h.start));
    parts.push(<mark key={h.start}>{text.slice(h.start, h.end)}</mark>);
    at = h.end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * WALL-04: one testimonial on its own page: the quote or video, the person,
 * a call to action and plain share links (SHARE-03). Approved, not withdrawn
 * and public consent only; anything else is a 404 (lib/testimonial-page.ts).
 */
export default async function TestimonialPage({ params }: Props) {
  const d = load((await params).id);
  if (!d) notFound();
  const { item, project } = d;
  const quote = quoteOf(item);
  const share = shareLinks(d.url, quote ? `“${quote}” — ${item.name}` : `${item.name} on ${project.name}`);
  const byline = [item.title, item.company].filter(Boolean).join(", ");
  const logo = mediaUrl(project.logoKey);
  const website = project.website && /^https?:\/\//i.test(project.website) ? project.website : null;
  const v = item.video;
  return (
    <div className="tp-page" style={accentStyle(project.accentColor)} data-testimonial-page={item.id}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(testimonialJsonLd(d)) }} />
      <TestimonialBeacon id={item.id} />
      <header className="tp-head">
        <a className="tp-brand" href={d.wallUrl}>
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" width={32} height={32} />
          )}
          <span>{project.name}</span>
        </a>
      </header>
      <main className="tp-main">
        <article className="tp-card" data-testid="testimonial-page">
          {v && (
            <video
              className="tp-video"
              controls
              playsInline
              preload={v.poster ? "none" : "metadata"}
              poster={v.poster ?? undefined}
              style={{ aspectRatio: videoRatio(v) }}
              data-testid="tp-video"
            >
              {(v.sources.length ? v.sources : [{ url: v.url, type: v.mime }]).map((s) => (
                <source key={s.url} src={s.url} type={s.type} />
              ))}
              {v.captionsUrl && <track kind="captions" src={v.captionsUrl} label="Captions" default />}
            </video>
          )}
          {item.rating ? <Stars rating={item.rating} label={`Rated ${item.rating} out of 5`} /> : null}
          {item.extra.headline && <h1 className="tp-headline">{item.extra.headline}</h1>}
          {item.text ? (
            <blockquote className="tp-quote">
              <p>
                <Highlighted text={item.text} marks={item.extra.highlights} />
              </p>
            </blockquote>
          ) : (
            !item.extra.headline && <h1 className="visually-hidden">{`${item.name} on ${project.name}`}</h1>
          )}
          {v?.transcript && (
            <details className="tp-transcript">
              <summary>Transcript</summary>
              <p>{v.transcript}</p>
            </details>
          )}
          <footer className="tp-person">
            {item.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="tp-avatar" src={item.avatarUrl} alt="" width={48} height={48} />
            ) : (
              <span className="tp-avatar tp-initials" aria-hidden="true">
                {initials(item.name)}
              </span>
            )}
            <span>
              <strong className="tp-name">{item.name}</strong>
              {byline && <span className="tp-byline">{byline}</span>}
            </span>
          </footer>
        </article>

        <nav className="tp-cta" aria-label="More from this project">
          <a className="button accent" href={website ?? d.wallUrl} data-tp-click="cta" data-testid="tp-cta">
            {website ? `Visit ${project.name}` : "Read more testimonials"}
            <Icon name="arrowRight" />
          </a>
          <a className="button secondary" href={website ? d.wallUrl : d.formUrl} data-tp-click="cta">
            {website ? "Read more testimonials" : "Share your own"}
          </a>
        </nav>

        <section className="tp-share" aria-labelledby="tp-share-title">
          <h2 id="tp-share-title">Share this testimonial</h2>
          <div className="tp-share-links">
            <a href={share.x} target="_blank" rel="noopener noreferrer" data-tp-click="share" data-testid="share-x">
              Post on X
            </a>
            <a href={share.linkedin} target="_blank" rel="noopener noreferrer" data-tp-click="share" data-testid="share-linkedin">
              Share on LinkedIn
            </a>
            <a href={share.facebook} target="_blank" rel="noopener noreferrer" data-tp-click="share" data-testid="share-facebook">
              Share on Facebook
            </a>
            <a href={share.email} data-tp-click="share" data-testid="share-email">
              Email
            </a>
            <CopyLink url={d.url} />
          </div>
        </section>
      </main>
    </div>
  );
}
