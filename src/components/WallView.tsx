import "./wall-view.css";
import type { CSSProperties, ReactNode } from "react";
import { LoadMore } from "@/app/wall/LoadMore";
import { WallBeacon } from "@/app/wall/WallBeacon";
import { jsonLdText } from "@/lib/seo";
import { textOn } from "@/lib/contrast";
import { accentStyle } from "@/lib/theme";
import type { WallViewData } from "@/lib/walls";
import { WIDGET_FONTS } from "@/lib/widget-config";
import { Stars, TestimonialCard } from "./TestimonialCard";
import { Icon } from "./Icon";

/**
 * A wall of love page (WALL-01, WALL-02): header, hero, tag tabs, cards with
 * an inline call to action after N of them, and "load more". Server-rendered
 * on the public pages, so the text and the structured data are in the HTML;
 * the editor renders the same component with `preview` (links and loading off).
 */

type Props = {
  data: WallViewData;
  preview?: boolean;
  /** schema.org data, rendered as an inert JSON-LD block (SEO-03). */
  jsonLd?: object;
};

const isExternal = (url: string) => /^https?:\/\//i.test(url);

function Link({ href, className, children, preview }: { href: string; className?: string; children: ReactNode; preview?: boolean }) {
  if (preview) return <span className={className}>{children}</span>;
  return (
    <a className={className} href={href} {...(isExternal(href) ? { rel: "noopener" } : {})}>
      {children}
    </a>
  );
}

/**
 * The text colour on a background the owner chose: theirs, else ink or
 * white, whichever reads better (the theme's own ink was picked for the
 * theme's background). "" leaves the theme's.
 */
export function inkFor(text: string, background: string): string {
  if (text) return text;
  return /^#[0-9a-f]{6}$/i.test(background) ? textOn(background) : "";
}

/** Config colours as CSS variables; "" leaves the theme's own. */
function vars(data: WallViewData): CSSProperties {
  const { config } = data.wall;
  // The project colour with a readable text colour on it, for the paper theme's call to action.
  const v: Record<string, string> = { ...accentStyle(data.project.accentColor) };
  const put = (k: string, c: string) => {
    if (/^#[0-9a-f]{6}$/i.test(c)) v[k] = c;
  };
  put("--wl-hero-bg", config.hero.background);
  put("--wl-hero-ink", inkFor(config.hero.text, config.hero.background));
  put("--wl-cta-bg", config.heroCta.background);
  put("--wl-cta-ink", inkFor(config.heroCta.color, config.heroCta.background));
  put("--wl-card", config.card.background);
  put("--wl-card-ink", inkFor(config.card.text, config.card.background));
  put("--wl-card-line", config.card.border);
  v["--wl-radius"] = `${config.card.radius}px`;
  const font = WIDGET_FONTS.find((f) => f.id === config.font);
  if (font?.family) v["--wl-font"] = font.family;
  return v as CSSProperties;
}

export function WallView({ data, preview, jsonLd }: Props) {
  const { wall, project, stats } = data;
  const cfg = wall.config;
  const font = WIDGET_FONTS.find((f) => f.id === cfg.font);
  const ctaUrl = (url: string) => url || data.formUrl;
  const tabHref = (i: number) => (i === 0 && cfg.tabs.defaultTab === 0 ? data.path : `${data.path}?tab=${i}`);
  const inline = cfg.inlineCta;
  const ctaBlock = inline.enabled ? (
    <aside className="wl-inline-cta" data-testid="wall-inline-cta">
      <div>
        <h2>{inline.title}</h2>
        {inline.text && <p>{inline.text}</p>}
      </div>
      <Link className="button accent" href={ctaUrl(inline.url)} preview={preview}>
        {inline.buttonText}
      </Link>
    </aside>
  ) : null;
  const cards: ReactNode[] = [];
  data.items.forEach((t, i) => {
    cards.push(<TestimonialCard key={t.id} t={t} display={cfg.display} />);
    if (ctaBlock && i + 1 === inline.after) cards.push(<div key="inline-cta" className="wl-span">{ctaBlock}</div>);
  });

  return (
    <div
      className="wl-page"
      data-wall-theme={wall.theme}
      data-shadow={cfg.card.shadow ? "on" : "off"}
      data-wall-id={wall.id}
      style={vars(data)}
    >
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(jsonLd) }} />}
      {!preview && <WallBeacon wallId={wall.id} />}
      {font?.file && (
        <style>{`@font-face{font-family:${font.family.split(",")[0]};src:url(${font.file}) format("woff2");font-display:swap;font-weight:100 900}`}</style>
      )}
      {(wall.logoUrl || cfg.nav.length > 0) && (
        <header className="wl-top">
          <div className="wl-wrap wl-top-row">
            {wall.logoUrl ? (
              cfg.logoLink ? (
                <Link href={cfg.logoLink} className="wl-logo" preview={preview}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={wall.logoUrl} alt={project.name} />
                </Link>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="wl-logo" src={wall.logoUrl} alt={project.name} />
              )
            ) : (
              <span />
            )}
            {cfg.nav.length > 0 && (
              <nav aria-label="Site" className="wl-nav">
                {cfg.nav.map((n) => (
                  <Link key={`${n.label}-${n.url}`} href={n.url} preview={preview}>
                    {n.label}
                  </Link>
                ))}
              </nav>
            )}
          </div>
        </header>
      )}

      <section
        className="wl-hero"
        data-align={cfg.hero.align}
        data-cover={wall.coverUrl ? "on" : undefined}
        style={wall.coverUrl ? ({ "--wl-cover": `url("${wall.coverUrl}")` } as CSSProperties) : undefined}
      >
        <div className="wl-wrap wl-hero-inner">
          <div className="wl-hero-text">
            <h1>{cfg.hero.title || wall.name}</h1>
            {cfg.hero.subtitle && <p className="wl-sub">{cfg.hero.subtitle}</p>}
            {cfg.hero.showStats && stats.count > 0 && (
              <div className="wl-stats" data-testid="wall-stats">
                {stats.average != null && (
                  <>
                    <Stars rating={Math.round(stats.average)} label={`Average rating ${stats.average.toFixed(1)} out of 5`} />
                    <strong>{stats.average.toFixed(1)}</strong>
                    <span aria-hidden>·</span>
                  </>
                )}
                <span>
                  {stats.count} {stats.count === 1 ? "testimonial" : "testimonials"}
                </span>
              </div>
            )}
            {cfg.heroCta.enabled && cfg.heroCta.text && (
              <Link className="button lg wl-cta" href={ctaUrl(cfg.heroCta.url)} preview={preview}>
                {cfg.heroCta.text}
              </Link>
            )}
          </div>
          {data.featured && (
            <div className="wl-featured" data-testid="wall-featured">
              <TestimonialCard t={data.featured} display={cfg.display} />
            </div>
          )}
        </div>
      </section>

      <main className="wl-wrap wl-main">
        {data.tabs.length > 1 && (
          <nav className="wl-tabs" aria-label="Filter testimonials" data-testid="wall-tabs">
            {data.tabs.map((t, i) =>
              preview ? (
                <span key={i} className="wl-tab" aria-current={i === data.tab ? "page" : undefined}>
                  {t.label}
                </span>
              ) : (
                <a key={i} className="wl-tab" href={tabHref(i)} aria-current={i === data.tab ? "page" : undefined}>
                  {t.label}
                </a>
              ),
            )}
          </nav>
        )}
        {data.items.length === 0 ? (
          <div className="empty">
            <Icon name="inbox" />
            <p>No testimonials here yet.</p>
          </div>
        ) : (
          <div className="wl-grid" data-testid="wall-grid" data-columns={cfg.layout.columns}>
            {cards}
            {!preview && data.nextOffset != null && (
              <LoadMore
                wallId={wall.id}
                tab={data.tab}
                nextOffset={data.nextOffset}
                infinite={cfg.layout.pagination === "infinite"}
                display={cfg.display}
                shown={data.items.length}
                ctaAfter={inline.enabled && data.items.length < inline.after ? inline.after : null}
                cta={ctaBlock}
              />
            )}
          </div>
        )}
        {preview && data.nextOffset != null && (
          <div className="wl-more">
            <span className="button secondary">Load more</span>
          </div>
        )}
      </main>
    </div>
  );
}
