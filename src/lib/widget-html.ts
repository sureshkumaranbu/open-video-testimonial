import type { FeedAggregate, FeedItem, PublicWidget } from "./widget-config";

/**
 * DISP-10: a widget as plain server-rendered HTML, for sites that include it
 * into their own page (PHP include, a static-site build, an edge include).
 * The review text is in the host's DOM with JavaScript off, so search engines
 * read it. Every value is escaped; the styles are scoped under
 * `.plaudit-include` and reuse widget.js's class names (.w, .grid, .list, .c).
 */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function escapeHtml(s: string | number | null | undefined): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

/** JSON for a <script type="application/ld+json"> block: "<" can't close the tag, and U+2028 and U+2029 stay escaped. */
export function jsonLdSafe(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const hexOr = (v: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(v) ? v : fallback);

function stars(rating: number, outOf: string) {
  const on = "★".repeat(rating);
  const off = "★".repeat(5 - rating);
  return `<div class="s" role="img" aria-label="${escapeHtml(`${rating} ${outOf} stars`)}">${on}<span class="o">${off}</span></div>`;
}

function formatDate(iso: string, precision: FeedItem["extra"]["datePrecision"]) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions =
    precision === "year" ? { year: "numeric" } : precision === "month" ? { month: "short", year: "numeric" } : { day: "numeric", month: "short", year: "numeric" };
  return d.toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}

function card(t: FeedItem, w: PublicWidget, abs: (u: string) => string) {
  const d = w.design;
  const out: string[] = [`<article class="c" data-testimonial-id="${escapeHtml(t.id)}">`];
  if (d.showVideo && t.video) {
    const sources = (t.video.sources.length ? t.video.sources : [{ url: t.video.url, type: t.video.mime }])
      .map((s) => `<source src="${escapeHtml(abs(s.url))}" type="${escapeHtml(s.type)}">`)
      .join("");
    const track = t.video.captionsUrl
      ? `<track kind="captions" label="Captions" src="${escapeHtml(abs(t.video.captionsUrl))}" default>`
      : "";
    const poster = t.video.poster ? ` poster="${escapeHtml(abs(t.video.poster))}"` : "";
    out.push(`<video controls playsinline preload="none" crossorigin="anonymous"${poster}>${sources}${track}</video>`);
    if (t.video.transcript)
      out.push(`<details class="tr"><summary>${escapeHtml(w.labels.transcript)}</summary><p>${escapeHtml(t.video.transcript)}</p></details>`);
  }
  if (d.showRating && t.rating) out.push(stars(t.rating, w.labels.outOf));
  if (d.showHeadline && t.extra.headline) out.push(`<h3 class="h">${escapeHtml(t.extra.headline)}</h3>`);
  if (t.text) out.push(`<blockquote class="q"><p>${escapeHtml(t.text)}</p></blockquote>`);
  if (d.showImages && t.extra.images.length)
    out.push(
      `<div class="im">${t.extra.images
        .slice(0, 3)
        .map((i) => `<img src="${escapeHtml(abs(i.url))}" alt="${escapeHtml(i.alt ?? "")}" loading="lazy">`)
        .join("")}</div>`,
    );
  const byline = d.showTitle ? [t.title, t.company].filter(Boolean).join(", ") : "";
  const date = d.date !== "hidden" ? formatDate(t.extra.date, t.extra.datePrecision) : "";
  out.push(
    `<footer class="a"><div><div class="n">${escapeHtml(t.name)}</div>` +
      (byline ? `<div class="m">${escapeHtml(byline)}</div>` : "") +
      (date ? `<div class="m"><time datetime="${escapeHtml(t.extra.date)}">${escapeHtml(date)}</time></div>` : "") +
      (d.showVerified && t.extra.verified ? `<div class="m vf">${escapeHtml(t.extra.verifiedLabel ?? w.labels.verified)}</div>` : "") +
      `</div>` +
      (d.showSource && t.extra.sourceUrl
        ? `<a class="src" href="${escapeHtml(t.extra.sourceUrl)}" rel="nofollow noopener" target="_blank">${escapeHtml(t.extra.platform ?? "Source")}</a>`
        : "") +
      `</footer>`,
  );
  out.push("</article>");
  return out.join("");
}

function css(w: PublicWidget, accent: string) {
  const d = w.design;
  const dark = d.theme === "dark";
  const p = (light: string, darkV: string) => (dark ? darkV : light);
  const root = ".plaudit-include";
  return (
    `${root}{--accent:${hexOr(d.accent, accent)};--on:${d.onAccent};--card:${hexOr(d.card, p("#ffffff", "#171b2b"))};--text:${hexOr(d.text, p("#161b2e", "#eef0f6"))};` +
    `--muted:${hexOr(d.dateColor, p("#545c70", "#a4abbd"))};--border:${hexOr(d.border, p("#e3e6ec", "#262c40"))};--star:${hexOr(d.star, "#f2a93b")};` +
    `--star-off:${p("#dfe2e8", "#343b52")};background:${hexOr(d.background, "transparent")};color:var(--text);` +
    `font-family:${d.fontFamily || "ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif"};line-height:1.55;` +
    `${d.maxWidth ? `max-width:${d.maxWidth}px;margin:0 auto;` : ""}}` +
    `${root} .grid{columns:${w.options.columns} 260px;column-gap:${d.spacing}px}` +
    `${root} .list{display:flex;flex-direction:column;gap:${d.spacing}px;max-width:720px;margin:0 auto}` +
    `${root} .c{break-inside:avoid;margin:0 0 ${d.spacing}px;background:var(--card);border:1px solid var(--border);border-radius:${d.radius}px;` +
    `${d.shadow && !dark ? "box-shadow:0 1px 3px rgb(22 27 46/.06);" : ""}padding:20px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box}` +
    `${root} .list .c{margin:0}${root} video{width:100%;border-radius:12px;background:#0d1020;display:block}` +
    `${root} .q{margin:0}${root} .q p{margin:0;white-space:pre-wrap;font-size:17px}` +
    `${root} .h{margin:0;font-size:16px}${root} .s{color:var(--star);letter-spacing:2px}${root} .s .o{color:var(--star-off)}` +
    `${root} .a{display:flex;justify-content:space-between;gap:12px;padding-top:12px;border-top:1px solid var(--border)}` +
    `${root} .n{font-weight:600;font-size:14px${d.titleColor ? `;color:${hexOr(d.titleColor, "inherit")}` : ""}}${root} .m{color:var(--muted);font-size:13px}` +
    `${root} .src{color:var(--muted);font-size:12px}${root} .im{display:flex;gap:8px}${root} .im img{width:72px;height:72px;object-fit:cover;border-radius:8px}` +
    `${root} .agg{display:flex;gap:8px;align-items:center;margin:0 0 ${d.spacing}px;font-size:15px}${root} .agg b{font-size:20px}` +
    `${root} .e{color:var(--muted);text-align:center;padding:24px}`
  );
}

export type HtmlProject = { name: string; slug: string; accentColor: string };

/**
 * The include's markup. `origin` makes media links absolute, since the HTML
 * ends up on another site. `jsonLd` adds Review and AggregateRating data.
 */
export function renderWidgetHtml(
  w: PublicWidget,
  project: HtmlProject,
  items: FeedItem[],
  agg: FeedAggregate,
  o: { jsonLd: boolean; origin: string },
): string {
  const abs = (u: string) => (/^https?:\/\//i.test(u) ? u : `${o.origin}${u.startsWith("/") ? "" : "/"}${u}`);
  const parts: string[] = [
    `<div class="plaudit-include" data-plaudit-include="${escapeHtml(w.id)}" data-layout="${escapeHtml(w.layout)}">`,
    `<style>${css(w, project.accentColor)}</style>`,
  ];
  if ((w.aggregate.show || w.layout === "badge") && agg.count) {
    parts.push(
      `<div class="agg">${agg.average != null ? `<b>${escapeHtml(agg.average.toFixed(1))}</b> ${stars(Math.round(agg.average), w.labels.outOf)}` : ""}` +
        `<span>${escapeHtml(agg.count)} ${escapeHtml(w.labels.reviews)}</span></div>`,
    );
  }
  if (w.layout !== "badge") {
    if (!items.length) parts.push(`<div class="e">${escapeHtml(w.labels.empty)}</div>`);
    // Moving layouts become a list here: without JavaScript nothing moves.
    else parts.push(`<div class="${w.layout === "grid" ? "grid" : "list"}">${items.map((t) => card(t, w, abs)).join("")}</div>`);
  }
  if (o.jsonLd) parts.push(`<script type="application/ld+json">${jsonLdSafe(reviewData(project, items, agg))}</script>`);
  parts.push("</div>");
  return parts.join("");
}

/** schema.org data for the include: up to 10 reviews and, once there's a rating, the aggregate. */
export function reviewData(project: HtmlProject, items: FeedItem[], agg: FeedAggregate) {
  const reviews = items
    .filter((t) => t.text)
    .slice(0, 10)
    .map((t) => ({
      "@type": "Review",
      author: { "@type": "Person", name: t.name },
      reviewBody: t.text,
      datePublished: t.extra.date.slice(0, 10),
      ...(t.rating ? { reviewRating: { "@type": "Rating", ratingValue: t.rating, bestRating: 5, worstRating: 1 } } : {}),
    }));
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: project.name,
    ...(agg.count >= 1 && agg.average != null
      ? { aggregateRating: { "@type": "AggregateRating", ratingValue: agg.average, reviewCount: agg.count, bestRating: 5, worstRating: 1 } }
      : {}),
    review: reviews,
  };
}
