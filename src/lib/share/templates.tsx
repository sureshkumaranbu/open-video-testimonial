import type { CSSProperties, ReactElement, ReactNode } from "react";
import { textOn } from "../contrast";
import { designSize, type ShareDesign, type ShareTemplateId } from "./design";

/**
 * The image studio's templates (SHARE-01), all our own, drawn by satori
 * (next/og). Satori lays out flexbox only: every element with more than one
 * child says `display: flex`, and words are separate spans so highlighted
 * phrases can wrap. Sizes scale from the image's short side, so one template
 * works from a 600×200 banner to a 1080×1920 story.
 */

/** What a template draws for one testimonial (already overridden, clipped and with images read). */
export type ShareCard = {
  id: string;
  name: string;
  byline: string;
  rating: number | null;
  headline: string | null;
  /** The words, in order, with which are highlighted. */
  segments: { text: string; hl: boolean }[];
  /** A data: URL (PNG or JPEG), else initials are drawn. */
  avatar: string | null;
};

export type Palette = {
  /** null = transparent. */
  bg: string | null;
  ink: string;
  surface: string;
  surfaceInk: string;
  line: string;
  accent: string;
  onAccent: string;
  highlight: string;
  highlightInk: string;
};

export type Frame = {
  width: number;
  height: number;
  /** 1 % of the short side. */
  u: number;
  pad: number;
  /** Room kept free at the top and bottom for a logo. */
  safeTop: number;
  safeBottom: number;
  portrait: boolean;
  /** Very short or very wide (an email banner). */
  banner: boolean;
};

export type TemplateProps = { cards: ShareCard[]; p: Palette; f: Frame; d: ShareDesign };

const THEMES = {
  light: { bg: "#ffffff", ink: "#161b2e", surface: "#ffffff", surfaceInk: "#161b2e", line: "#e3e6ec" },
  dark: { bg: "#12152a", ink: "#eef0f7", surface: "#1b1f36", surfaceInk: "#eef0f7", line: "#2c3250" },
};

/** The design's colours, with readable text on whatever is behind it. */
export function palette(d: ShareDesign, projectAccent: string): Palette {
  const t = THEMES[d.theme];
  const accent = d.accent || projectAccent || "#161b2e";
  const kind = d.background.kind;
  const base = d.background.color || t.bg;
  const bg = kind === "transparent" ? null : base;
  const ink = d.text || (kind === "image" ? "#ffffff" : kind === "transparent" ? t.ink : textOn(base, THEMES.light.ink));
  return {
    bg,
    ink,
    surface: t.surface,
    surfaceInk: t.surfaceInk,
    line: t.line,
    accent,
    onAccent: textOn(accent),
    highlight: d.highlight,
    highlightInk: textOn(d.highlight, "#1c1600"),
  };
}

export function frame(d: ShareDesign, logoHeight: number): Frame {
  const { width, height } = designSize(d);
  const short = Math.min(width, height);
  const u = short / 100;
  const banner = height < 320 || width / height > 2.4;
  const pad = Math.round(Math.max(14, Math.min(banner ? u * 9 : u * 7, 120)));
  const gap = logoHeight ? logoHeight + Math.round(pad * 0.5) : 0;
  const top = d.logo.position.startsWith("top") ? gap : 0;
  const bottom = d.logo.position.startsWith("bottom") ? gap : 0;
  return { width, height, u, pad, safeTop: top, safeBottom: bottom, portrait: height > width * 1.1, banner };
}

/**
 * A font size that fits `chars` characters of text in a w×h box (Geist is
 * about half an em wide per character, lines 1.35 em apart), within [min, max].
 */
export function fitText(chars: number, w: number, h: number, min: number, max: number) {
  const n = Math.max(chars, 12);
  const size = Math.sqrt((w * h) / (n * 0.56 * 1.4)) * 0.92;
  return Math.round(Math.max(min, Math.min(max, size)));
}

const charsOf = (c: ShareCard) => c.segments.reduce((n, s) => n + s.text.length, 0);

const STAR = "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z";

function Stars({ rating, size, off }: { rating: number; size: number; off: string }) {
  return (
    <div style={{ display: "flex", gap: Math.max(1, size * 0.08) }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} width={size} height={size} viewBox="0 0 24 24">
          <path d={STAR} fill={n <= rating ? "#f2a93b" : off} />
        </svg>
      ))}
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

function Avatar({ card, size, p }: { card: ShareCard; size: number; p: Palette }) {
  if (card.avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={card.avatar} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: size, objectFit: "cover" }} />;
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size,
        background: p.accent,
        color: p.onAccent,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.4,
      }}
    >
      {initials(card.name)}
    </div>
  );
}

/** The words as wrapping spans, highlighted phrases on the highlight colour, inside curly quotes. */
function Quote({ card, size, color, p, align = "left", marks = true }: { card: ShareCard; size: number; color: string; p: Palette; align?: "left" | "center"; marks?: boolean }) {
  const words: ReactNode[] = [];
  const all = card.segments.flatMap((s) => s.text.split(/\s+/).filter(Boolean).map((w) => ({ w, hl: s.hl })));
  all.forEach((x, i) => {
    const first = i === 0;
    const last = i === all.length - 1;
    const text = `${first && marks ? "“" : ""}${x.w}${last && marks ? "”" : ""}`;
    const nextHl = !last && all[i + 1].hl;
    const style: CSSProperties = x.hl
      ? {
          background: p.highlight,
          color: p.highlightInk,
          paddingLeft: i === 0 || !all[i - 1].hl ? size * 0.12 : 0,
          paddingRight: nextHl ? 0 : size * 0.12,
          marginRight: nextHl ? 0 : size * 0.12,
        }
      : {};
    // A no-break space inside a highlighted run keeps its colour unbroken between words.
    words.push(
      <span key={i} style={style}>
        {x.hl && nextHl ? `${text} ` : last ? text : `${text} `}
      </span>,
    );
  });
  return (
    <div style={{ display: "flex", flexWrap: "wrap", fontSize: size, lineHeight: 1.36, color, justifyContent: align === "center" ? "center" : "flex-start", letterSpacing: -size * 0.01 }}>
      {words}
    </div>
  );
}

function Person({ card, size, color, p, d, center }: { card: ShareCard; size: number; color: string; p: Palette; d: ShareDesign; center?: boolean }) {
  const showAvatar = d.showAvatar;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.7, justifyContent: center ? "center" : "flex-start" }}>
      {showAvatar && <Avatar card={card} size={Math.round(size * 2.6)} p={p} />}
      <div style={{ display: "flex", flexDirection: "column", alignItems: center && !showAvatar ? "center" : "flex-start" }}>
        <div style={{ display: "flex", fontSize: size, color }}>{card.name}</div>
        {d.showTitle && card.byline && <div style={{ display: "flex", fontSize: size * 0.82, color, opacity: 0.7 }}>{card.byline}</div>}
      </div>
    </div>
  );
}

const rated = (card: ShareCard, d: ShareDesign) => d.showRating && card.rating !== null && card.rating > 0;
const starOff = (ink: string) => (textOn(ink) === "#ffffff" ? "rgba(22,27,46,0.18)" : "rgba(255,255,255,0.28)");

/** The area inside the padding and clear of the logo. */
function Body({ f, children, style }: { f: Frame; children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        left: f.pad,
        right: f.pad,
        top: f.pad + f.safeTop,
        bottom: f.pad + f.safeBottom,
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const inner = (f: Frame) => ({ w: f.width - f.pad * 2, h: f.height - f.pad * 2 - f.safeTop - f.safeBottom });

// ------------------------------------------------------------------ single

function Spotlight({ cards: [c], p, f, d }: TemplateProps) {
  const { w, h } = inner(f);
  const meta = f.u * (f.banner ? 6 : 3.4);
  const size = fitText(charsOf(c), w * 0.92, h - meta * (f.banner ? 2 : 5), f.u * 4, f.u * (f.banner ? 12 : 8.5));
  return (
    <Body f={f} style={{ alignItems: "center", justifyContent: "center", gap: meta * 0.9 }}>
      {!f.banner && <div style={{ display: "flex", fontSize: size * 3, lineHeight: 0.6, height: size * 1.2, color: p.accent }}>“</div>}
      {rated(c, d) && !f.banner && <Stars rating={c.rating!} size={meta * 1.1} off={starOff(p.ink)} />}
      <Quote card={c} size={size} color={p.ink} p={p} align="center" marks={f.banner} />
      <Person card={c} size={meta} color={p.ink} p={p} d={d} center />
    </Body>
  );
}

function Margin({ cards: [c], p, f, d }: TemplateProps) {
  const { w, h } = inner(f);
  const bar = Math.max(4, f.u * 1.4);
  const meta = f.u * (f.banner ? 6 : 3.2);
  const size = fitText(charsOf(c), w - bar * 4, h - meta * 5, f.u * 4, f.u * 8);
  return (
    <Body f={f} style={{ justifyContent: "space-between" }}>
      <div style={{ display: "flex", gap: bar * 3, flex: 1, alignItems: "center" }}>
        <div style={{ display: "flex", width: bar, alignSelf: "stretch", background: p.accent, borderRadius: bar }} />
        <div style={{ display: "flex", flexDirection: "column", gap: meta, flex: 1 }}>
          {rated(c, d) && <Stars rating={c.rating!} size={meta * 1.1} off={starOff(p.ink)} />}
          <Quote card={c} size={size} color={p.ink} p={p} />
        </div>
      </div>
      <div style={{ display: "flex", paddingLeft: bar * 4, paddingTop: meta * 0.8 }}>
        <Person card={c} size={meta} color={p.ink} p={p} d={d} />
      </div>
    </Body>
  );
}

function Postcard({ cards: [c], p, f, d }: TemplateProps) {
  const { w, h } = inner(f);
  const cp = f.pad * 0.8;
  const meta = f.u * (f.banner ? 5.5 : 3.1);
  const size = fitText(charsOf(c), w - cp * 2, h - cp * 2 - meta * 5, f.u * 3.6, f.u * 7.4);
  return (
    <Body f={f} style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: meta,
          padding: cp,
          width: "100%",
          maxHeight: "100%",
          background: p.surface,
          borderRadius: f.u * 3.5,
          boxShadow: `0 ${f.u * 1.2}px ${f.u * 4}px rgba(10,12,20,0.18)`,
          border: `1px solid ${p.line}`,
        }}
      >
        {rated(c, d) && <Stars rating={c.rating!} size={meta * 1.1} off={starOff(p.surfaceInk)} />}
        <Quote card={c} size={size} color={p.surfaceInk} p={p} />
        <Person card={c} size={meta} color={p.surfaceInk} p={p} d={d} />
      </div>
    </Body>
  );
}

function Headline({ cards: [c], p, f, d }: TemplateProps) {
  const { w, h } = inner(f);
  const title = c.headline || c.segments.map((s) => s.text).join(" ").split(/(?<=[.!?])\s/)[0];
  const rest: ShareCard = c.headline ? c : { ...c, segments: [] };
  const meta = f.u * (f.banner ? 5.5 : 3.1);
  const big = fitText(title.length, w, h * 0.42, f.u * 5, f.u * (f.banner ? 13 : 11));
  const small = fitText(charsOf(rest), w, h * 0.35, f.u * 3, f.u * 4.6);
  return (
    <Body f={f} style={{ justifyContent: "center", gap: meta }}>
      {rated(c, d) && <Stars rating={c.rating!} size={meta * 1.3} off={starOff(p.ink)} />}
      <div style={{ display: "flex", fontSize: big, lineHeight: 1.12, letterSpacing: -big * 0.025, color: p.ink }}>{title}</div>
      {rest.segments.length > 0 && !f.banner && <Quote card={rest} size={small} color={p.ink} p={p} marks />}
      <div style={{ display: "flex", width: f.u * 10, height: Math.max(3, f.u * 0.6), background: p.accent }} />
      <Person card={c} size={meta} color={p.ink} p={p} d={d} />
    </Body>
  );
}

function Portrait({ cards: [c], p, f, d }: TemplateProps) {
  const { w, h } = inner(f);
  const side = !f.portrait;
  const photo = Math.round(Math.min(side ? h * 0.75 : w * 0.42, f.u * 34));
  const meta = f.u * (f.banner ? 5.5 : 3.2);
  const size = fitText(charsOf(c), side ? w - photo - f.pad : w, side ? h - meta * 4 : h - photo - meta * 5, f.u * 3.6, f.u * 7.6);
  return (
    <Body f={f} style={{ flexDirection: side ? "row" : "column", alignItems: "center", justifyContent: "center", gap: f.pad }}>
      <Avatar card={c} size={photo} p={p} />
      <div style={{ display: "flex", flexDirection: "column", gap: meta, flex: 1, alignItems: side ? "flex-start" : "center" }}>
        {rated(c, d) && <Stars rating={c.rating!} size={meta * 1.1} off={starOff(p.ink)} />}
        <Quote card={c} size={size} color={p.ink} p={p} align={side ? "left" : "center"} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: side ? "flex-start" : "center" }}>
          <div style={{ display: "flex", fontSize: meta * 1.1, color: p.ink }}>{c.name}</div>
          {d.showTitle && c.byline && <div style={{ display: "flex", fontSize: meta * 0.85, color: p.ink, opacity: 0.7 }}>{c.byline}</div>}
        </div>
      </div>
    </Body>
  );
}

function Split({ cards: [c], p, f, d }: TemplateProps) {
  const side = !f.portrait;
  const panel = side ? Math.round(f.width * 0.36) : Math.round(f.height * 0.3);
  const meta = f.u * (f.banner ? 6 : 3.4);
  const qw = side ? f.width - panel - f.pad * 2 : f.width - f.pad * 2;
  const qh = side ? f.height - f.pad * 2 - f.safeTop - f.safeBottom : f.height - panel - f.pad * 2 - f.safeBottom;
  const size = fitText(charsOf(c), qw, qh, f.u * 3.6, f.u * 7.6);
  return (
    <div style={{ position: "absolute", top: 0, left: 0, width: f.width, height: f.height, display: "flex", flexDirection: side ? "row" : "column" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: meta * 0.8,
          background: p.accent,
          color: p.onAccent,
          width: side ? panel : f.width,
          height: side ? f.height : panel,
          padding: f.pad,
          paddingTop: side ? f.pad + f.safeTop : f.pad + f.safeTop,
        }}
      >
        {d.showAvatar && <Avatar card={c} size={Math.round(meta * (f.banner ? 2.2 : 4))} p={{ ...p, accent: p.onAccent, onAccent: p.accent }} />}
        <div style={{ display: "flex", fontSize: meta * 1.1, textAlign: "center" }}>{c.name}</div>
        {d.showTitle && c.byline && !f.banner && <div style={{ display: "flex", fontSize: meta * 0.85, opacity: 0.8, textAlign: "center" }}>{c.byline}</div>}
        {rated(c, d) && <Stars rating={c.rating!} size={meta} off={p.onAccent === "#ffffff" ? "rgba(255,255,255,0.35)" : "rgba(22,27,46,0.2)"} />}
      </div>
      <div style={{ display: "flex", flex: 1, alignItems: "center", padding: f.pad, paddingBottom: f.pad + f.safeBottom }}>
        <Quote card={c} size={size} color={p.ink} p={p} />
      </div>
    </div>
  );
}

function Bubble({ cards: [c], p, f, d }: TemplateProps) {
  const { w, h } = inner(f);
  const meta = f.u * (f.banner ? 5.5 : 3.2);
  const tail = Math.max(10, f.u * 3);
  const bp = f.pad * 0.7;
  const size = fitText(charsOf(c), w - bp * 2, h - bp * 2 - meta * 4.5 - tail, f.u * 3.6, f.u * 7.4);
  return (
    <Body f={f} style={{ justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: meta * 0.8, padding: bp, background: p.accent, borderRadius: f.u * 4 }}>
          {rated(c, d) && <Stars rating={c.rating!} size={meta * 1.05} off={p.onAccent === "#ffffff" ? "rgba(255,255,255,0.35)" : "rgba(22,27,46,0.2)"} />}
          <Quote card={c} size={size} color={p.onAccent} p={p} marks={false} />
        </div>
        <div style={{ display: "flex", marginLeft: f.u * 8 }}>
          <svg width={tail * 2} height={tail} viewBox="0 0 20 10">
            <path d="M0 0h20L4 10z" fill={p.accent} />
          </svg>
        </div>
        <div style={{ display: "flex", paddingLeft: f.u * 4, paddingTop: meta * 0.4 }}>
          <Person card={c} size={meta} color={p.ink} p={p} d={d} />
        </div>
      </div>
    </Body>
  );
}

function Stamp({ cards: [c], p, f, d }: TemplateProps) {
  const { w, h } = inner(f);
  const side = !f.portrait;
  const badge = Math.round(Math.min(side ? h * 0.8 : w * 0.5, f.u * 40));
  const meta = f.u * (f.banner ? 5.5 : 3.2);
  const size = fitText(charsOf(c), side ? w - badge - f.pad : w, side ? h - meta * 4 : h - badge - meta * 5, f.u * 3.4, f.u * 7);
  const r = c.rating && d.showRating ? c.rating : null;
  return (
    <Body f={f} style={{ flexDirection: side ? "row" : "column", alignItems: "center", justifyContent: "center", gap: f.pad }}>
      <div
        style={{
          width: badge,
          height: badge,
          borderRadius: badge,
          border: `${Math.max(3, badge * 0.04)}px solid ${p.accent}`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: badge * 0.04,
          color: p.accent,
        }}
      >
        <div style={{ display: "flex", fontSize: badge * 0.3, lineHeight: 1 }}>{r ? `${r}.0` : "“"}</div>
        {r ? <Stars rating={r} size={badge * 0.12} off={starOff(p.ink)} /> : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: meta, flex: 1 }}>
        <Quote card={c} size={size} color={p.ink} p={p} />
        <Person card={c} size={meta} color={p.ink} p={p} d={d} />
      </div>
    </Body>
  );
}

function Minimal({ cards: [c], p, f, d }: TemplateProps) {
  const { w, h } = inner(f);
  const meta = f.u * (f.banner ? 5.5 : 3);
  const size = fitText(charsOf(c), w, h - meta * 3, f.u * 4, f.u * 9);
  return (
    <Body f={f} style={{ justifyContent: "center", gap: meta * 1.4 }}>
      <Quote card={c} size={size} color={p.ink} p={p} />
      <div style={{ display: "flex", fontSize: meta, color: p.ink, opacity: 0.75 }}>{`— ${c.name}${d.showTitle && c.byline ? `, ${c.byline}` : ""}`}</div>
    </Body>
  );
}

function Ticket({ cards: [c], p, f, d }: TemplateProps) {
  const { w, h } = inner(f);
  const side = !f.portrait;
  const stub = side ? Math.round(w * 0.3) : Math.round(h * 0.26);
  const tp = f.pad * 0.7;
  const meta = f.u * (f.banner ? 5 : 3.1);
  const size = fitText(charsOf(c), (side ? w - stub : w) - tp * 2, (side ? h : h - stub) - tp * 2, f.u * 3.4, f.u * 7);
  const perf = `${Math.max(2, f.u * 0.4)}px dashed ${p.line}`;
  return (
    <Body f={f} style={{ justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: side ? "row" : "column", background: p.surface, borderRadius: f.u * 3, border: `1px solid ${p.line}`, maxHeight: "100%" }}>
        <div style={{ display: "flex", flex: 1, padding: tp, alignItems: "center" }}>
          <Quote card={c} size={size} color={p.surfaceInk} p={p} />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: meta * 0.6,
            padding: tp,
            width: side ? stub : "100%",
            ...(side ? { borderLeft: perf } : { borderTop: perf }),
          }}
        >
          {rated(c, d) && <Stars rating={c.rating!} size={meta} off={starOff(p.surfaceInk)} />}
          <Person card={c} size={meta} color={p.surfaceInk} p={p} d={d} />
        </div>
      </div>
    </Body>
  );
}

// ------------------------------------------------------------------ several

function SmallCard({ c, p, d, size, meta, pad, style }: { c: ShareCard; p: Palette; d: ShareDesign; size: number; meta: number; pad: number; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: meta * 0.8,
        padding: pad,
        background: p.surface,
        border: `1px solid ${p.line}`,
        borderRadius: pad * 0.8,
        overflow: "hidden",
        ...style,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: meta * 0.6 }}>
        {rated(c, d) && <Stars rating={c.rating!} size={meta} off={starOff(p.surfaceInk)} />}
        <Quote card={c} size={size} color={p.surfaceInk} p={p} />
      </div>
      <Person card={c} size={meta} color={p.surfaceInk} p={p} d={d} />
    </div>
  );
}

function Trio({ cards, p, f, d }: TemplateProps) {
  const { w, h } = inner(f);
  const n = cards.length;
  const across = !f.portrait && n > 1;
  const gap = f.pad * 0.5;
  const cw = across ? (w - gap * (n - 1)) / n : w;
  const ch = across ? h : (h - gap * (n - 1)) / n;
  const cp = Math.max(10, f.u * 3);
  const meta = f.u * (f.banner ? 4.5 : 2.5);
  const size = Math.min(...cards.map((c) => fitText(charsOf(c), cw - cp * 2, ch - cp * 2 - meta * 4, f.u * 2.2, f.u * 4.6)));
  return (
    <Body f={f} style={{ flexDirection: across ? "row" : "column", gap }}>
      {cards.map((c) => (
        <SmallCard key={c.id} c={c} p={p} d={d} size={size} meta={meta} pad={cp} style={{ flex: 1 }} />
      ))}
    </Body>
  );
}

function Stack({ cards, p, f, d }: TemplateProps) {
  const { w, h } = inner(f);
  const n = cards.length;
  const gap = f.pad * 0.45;
  const ch = (h - gap * (n - 1)) / n;
  const meta = f.u * (f.banner ? 4.5 : 2.6);
  const size = Math.min(...cards.map((c) => fitText(charsOf(c), w - meta * 6, ch - meta * 3.5, f.u * 2.2, f.u * 5)));
  return (
    <Body f={f} style={{ gap, justifyContent: "center" }}>
      {cards.map((c, i) => (
        <div key={c.id} style={{ display: "flex", gap: meta, flex: 1, alignItems: "center", flexDirection: i % 2 ? "row-reverse" : "row" }}>
          {d.showAvatar && <Avatar card={c} size={Math.round(meta * 3.4)} p={p} />}
          <div style={{ display: "flex", flexDirection: "column", gap: meta * 0.5, flex: 1, alignItems: i % 2 ? "flex-end" : "flex-start" }}>
            <Quote card={c} size={size} color={p.ink} p={p} align="left" />
            <div style={{ display: "flex", fontSize: meta, color: p.ink, opacity: 0.75 }}>{`${c.name}${d.showTitle && c.byline ? ` · ${c.byline}` : ""}`}</div>
          </div>
        </div>
      ))}
    </Body>
  );
}

function Grid({ cards, p, f, d }: TemplateProps) {
  const { w, h } = inner(f);
  const n = cards.length;
  const cols = f.banner ? n : f.portrait ? (n > 2 ? 2 : 1) : n > 4 ? 3 : n > 1 ? 2 : 1;
  const rows = Math.ceil(n / cols);
  const gap = f.pad * 0.4;
  const cw = (w - gap * (cols - 1)) / cols;
  const ch = (h - gap * (rows - 1)) / rows;
  const cp = Math.max(8, f.u * 2.4);
  const meta = f.u * (f.banner ? 4 : 2.2);
  const size = Math.min(...cards.map((c) => fitText(charsOf(c), cw - cp * 2, ch - cp * 2 - meta * 4, f.u * 1.8, f.u * 4)));
  return (
    <Body f={f} style={{ flexDirection: "row", flexWrap: "wrap", gap, alignContent: "center" }}>
      {cards.map((c) => (
        <SmallCard key={c.id} c={c} p={p} d={{ ...d, showAvatar: d.showAvatar && !f.banner }} size={size} meta={meta} pad={cp} style={{ width: cw, height: ch }} />
      ))}
    </Body>
  );
}

function Mosaic({ cards, p, f, d }: TemplateProps) {
  const [lead, ...rest] = cards;
  if (!rest.length || f.banner) return <Grid cards={cards} p={p} f={f} d={d} />;
  const { w, h } = inner(f);
  const gap = f.pad * 0.4;
  const across = !f.portrait;
  const leadW = across ? w * 0.52 : w;
  const leadH = across ? h : h * 0.46;
  const restW = across ? w - leadW - gap : w;
  const restH = across ? h : h - leadH - gap;
  const cols = across ? (rest.length > 2 ? 2 : 1) : rest.length > 1 ? 2 : 1;
  const rows = Math.ceil(rest.length / cols);
  const cw = (restW - gap * (cols - 1)) / cols;
  const ch = (restH - gap * (rows - 1)) / rows;
  const cp = Math.max(8, f.u * 2.4);
  const meta = f.u * 2.2;
  const small = Math.min(...rest.map((c) => fitText(charsOf(c), cw - cp * 2, ch - cp * 2 - meta * 4, f.u * 1.8, f.u * 3.6)));
  const big = fitText(charsOf(lead), leadW - cp * 3, leadH - cp * 3 - meta * 5, f.u * 2.6, f.u * 6.4);
  return (
    <Body f={f} style={{ flexDirection: across ? "row" : "column", gap }}>
      <SmallCard c={lead} p={{ ...p, surface: p.accent, surfaceInk: p.onAccent }} d={d} size={big} meta={meta * 1.2} pad={cp * 1.5} style={{ width: leadW, height: leadH }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap, width: restW, height: restH }}>
        {rest.map((c) => (
          <SmallCard key={c.id} c={c} p={p} d={d} size={small} meta={meta} pad={cp} style={{ width: cw, height: ch }} />
        ))}
      </div>
    </Body>
  );
}

export const TEMPLATES: Record<ShareTemplateId, (props: TemplateProps) => ReactElement> = {
  spotlight: Spotlight,
  margin: Margin,
  postcard: Postcard,
  headline: Headline,
  portrait: Portrait,
  split: Split,
  bubble: Bubble,
  stamp: Stamp,
  minimal: Minimal,
  ticket: Ticket,
  trio: Trio,
  stack: Stack,
  grid: Grid,
  mosaic: Mosaic,
};
