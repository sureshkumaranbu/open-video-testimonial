import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { ImageResponse } from "next/og";
import { getDb, schema } from "@/db";
import type { Project } from "@/db/schema";
import { env } from "../env";
import { listHighlights } from "../highlights";
import { ffmpegAvailable } from "../media";
import { storage } from "../storage";
import { hasPublicPage } from "../testimonial-page";
import { getTestimonial, type TestimonialWithTags } from "../testimonials";
import { designSize, SHARE_FONTS, templateInfo, type RenderSpec, type ShareDesign, type ShareFontId, type ShareFormat, type ShareOverride } from "./design";
import { frame, palette, TEMPLATES, type ShareCard } from "./templates";

const { shareAssets } = schema;

/**
 * Server-side rendering for the image studio (SHARE-01) and the /t/ link
 * preview (WALL-04): a design plus testimonials in, PNG (or JPEG) bytes out,
 * drawn by next/og (satori + resvg) with TTF fonts from public/fonts/og
 * (D22), so the image is the same in every browser. Images it draws (photos,
 * logos, backgrounds) are read from storage and inlined; only PNG and JPEG,
 * which satori can draw.
 */

export class ShareError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const FONT_DIR = () => path.join(process.cwd(), "public", "fonts", "og");
const fontCache = new Map<string, Promise<Buffer | null>>();

function fontData(file: string) {
  let p = fontCache.get(file);
  if (!p) {
    p = fs.promises.readFile(path.join(FONT_DIR(), file)).catch(() => null);
    fontCache.set(file, p);
  }
  return p;
}

/** The fonts whose TTF is present (Geist always ships). */
export function availableFonts(): ShareFontId[] {
  return SHARE_FONTS.filter((f) => fs.existsSync(path.join(FONT_DIR(), f.file))).map((f) => f.id);
}

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

/** A stored PNG or JPEG as a data: URL satori can draw, else null (missing, too big, or another type). */
export async function imageData(key: string | null | undefined): Promise<string | null> {
  if (!key || !/\.(png|jpe?g)$/i.test(key)) return null;
  const stream = await storage().read(key).catch(() => null);
  if (!stream) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > MAX_IMAGE_BYTES) return null;
    chunks.push(chunk);
  }
  return `data:${/\.png$/i.test(key) ? "image/png" : "image/jpeg"};base64,${Buffer.concat(chunks).toString("base64")}`;
}

// Emoji would make the renderer fetch pictures from a CDN; they're dropped instead.
const PICTOGRAPHS = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;
const tidy = (s: string) => s.replace(PICTOGRAPHS, "").replace(/\s+/g, " ").trim();

type Segment = { text: string; hl: boolean };

/** Text with saved highlights ([start, end) offsets) as segments. */
export function segmentsFromHighlights(text: string, marks: { start: number; end: number }[]): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const m of [...marks].sort((a, b) => a.start - b.start)) {
    if (m.start < at || m.end > text.length || m.start >= m.end) continue;
    if (m.start > at) out.push({ text: text.slice(at, m.start), hl: false });
    out.push({ text: text.slice(m.start, m.end), hl: true });
    at = m.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), hl: false });
  return out.map((s) => ({ ...s, text: tidy(s.text) })).filter((s) => s.text);
}

/** An override's text, where **words** are highlighted. */
export function segmentsFromMarkers(text: string): Segment[] {
  return text
    .split(/\*\*/)
    .map((t, i) => ({ text: tidy(t), hl: i % 2 === 1 }))
    .filter((s) => s.text);
}

/** At most `max` characters, cut at a word with an ellipsis. */
export function clipSegments(segs: Segment[], max: number): Segment[] {
  const out: Segment[] = [];
  let left = max;
  for (const s of segs) {
    if (left <= 0) break;
    if (s.text.length <= left) {
      out.push(s);
      left -= s.text.length + 1;
      continue;
    }
    const cut = s.text.slice(0, left).replace(/\s+\S*$/, "").trimEnd();
    out.push({ text: `${cut || s.text.slice(0, left)}…`, hl: s.hl });
    break;
  }
  return out;
}

/** Characters a card keeps, by how many share an image. */
function maxChars(count: number, banner: boolean) {
  if (banner) return count > 1 ? 70 : 150;
  return count >= 4 ? 170 : count >= 2 ? 260 : 560;
}

/**
 * The testimonials an image shows, in order, with overrides applied. All of
 * them must belong to the project; `publicOnly` (the /t/ preview) also
 * requires each to have a public page.
 */
export async function shareCards(projectId: string, items: ShareOverride[], o: { publicOnly?: boolean; banner?: boolean } = {}): Promise<ShareCard[]> {
  const rows: TestimonialWithTags[] = [];
  for (const it of items) {
    const t = getTestimonial(it.id);
    if (!t || t.projectId !== projectId || (o.publicOnly && !hasPublicPage(t))) throw new ShareError(400, "Choose testimonials from this project");
    rows.push(t);
  }
  return Promise.all(
    rows.map(async (t, i) => {
      const it = items[i];
      const base = t.text?.trim() ? t.text : t.transcript?.trim() ? t.transcript : (t.headline ?? "");
      const marks = t.text?.trim() ? listHighlights(t.id).filter((h) => h.answerId === null) : [];
      const segments = it.text !== undefined && it.text.trim() ? segmentsFromMarkers(it.text) : segmentsFromHighlights(base, marks);
      return {
        id: t.id,
        name: tidy(it.name || t.authorName) || "Anonymous",
        byline: tidy(it.byline ?? [t.authorTitle, t.authorCompany].filter(Boolean).join(", ")),
        rating: t.rating,
        headline: t.headline ? tidy(t.headline) : null,
        segments: clipSegments(segments, maxChars(items.length, Boolean(o.banner))),
        avatar: await imageData(t.avatarKey),
      };
    }),
  );
}

/** An uploaded studio image of this project, as a data: URL. */
async function assetData(projectId: string, assetId: string, kind: "background" | "logo") {
  if (!assetId) return null;
  const row = getDb()
    .select()
    .from(shareAssets)
    .where(and(eq(shareAssets.id, assetId), eq(shareAssets.projectId, projectId), eq(shareAssets.kind, kind)))
    .get();
  return row ? imageData(row.key) : null;
}

/** A repeating pattern of our own as an SVG data: URL the size of the image. */
export function patternSvg(kind: ShareDesign["background"]["pattern"], width: number, height: number, color: string, unit: number): string {
  const s = Math.max(12, Math.round(unit * 5));
  let shape: string;
  if (kind === "dots") shape = `<circle cx="${s / 2}" cy="${s / 2}" r="${(s * 0.09).toFixed(1)}" fill="${color}"/>`;
  else if (kind === "grid") shape = `<path d="M${s} 0V${s}H0" fill="none" stroke="${color}" stroke-width="${Math.max(1, s * 0.04).toFixed(1)}"/>`;
  else if (kind === "diagonal") shape = `<path d="M0 ${s}L${s} 0M${-s / 2} ${s / 2}L${s / 2} ${-s / 2}M${s / 2} ${s * 1.5}L${s * 1.5} ${s / 2}" stroke="${color}" stroke-width="${Math.max(1, s * 0.06).toFixed(1)}"/>`;
  else if (kind === "waves") shape = `<path d="M0 ${s * 0.6}q${s / 4} ${-s * 0.35} ${s / 2} 0t${s / 2} 0" fill="none" stroke="${color}" stroke-width="${Math.max(1, s * 0.06).toFixed(1)}"/>`;
  else {
    // Confetti: a fixed scatter (same image every time), not random per render.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const tile = s * 4;
    const bits: string[] = [];
    for (let i = 0; i < 14; i++) {
      const x = (rnd() * tile).toFixed(1);
      const y = (rnd() * tile).toFixed(1);
      const r = (rnd() * 180).toFixed(0);
      bits.push(i % 3 ? `<rect x="${x}" y="${y}" width="${(s * 0.5).toFixed(1)}" height="${(s * 0.16).toFixed(1)}" rx="${(s * 0.06).toFixed(1)}" fill="${color}" transform="rotate(${r} ${x} ${y})"/>` : `<circle cx="${x}" cy="${y}" r="${(s * 0.12).toFixed(1)}" fill="${color}"/>`);
    }
    return svgUrl(width, height, tile, bits.join(""));
  }
  return svgUrl(width, height, s, shape);
}

function svgUrl(width: number, height: number, tile: number, shape: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="p" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse">${shape}</pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** #rrggbb at `alpha`, for satori. */
const rgba = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

export type RenderContext = {
  project: Pick<Project, "id" | "accentColor" | "logoKey">;
  publicOnly?: boolean;
};

/** Renders one image as PNG. A JPEG can't be transparent, so `opaque` paints the theme's background instead. */
export async function renderPng(spec: RenderSpec, ctx: RenderContext, o: { opaque?: boolean } = {}): Promise<Uint8Array> {
  let d = spec.design;
  if (o.opaque && d.background.kind === "transparent") d = { ...d, background: { ...d.background, kind: "solid" } };
  const { width, height } = designSize(d);
  const scale = width / 1080;
  const logoUrl = d.logo.source === "brand" ? await imageData(ctx.project.logoKey) : d.logo.source === "upload" ? await assetData(ctx.project.id, d.logo.assetId, "logo") : null;
  const logoH = logoUrl ? Math.round(Math.min(d.logo.size * scale, height * 0.25)) : 0;
  const f = frame(d, logoH);
  const p = palette(d, ctx.project.accentColor);
  const info = templateInfo(d.template);
  const cards = await shareCards(ctx.project.id, spec.items.slice(0, info.max), { publicOnly: ctx.publicOnly, banner: f.banner });
  const Template = TEMPLATES[d.template];

  const bg = d.background;
  const base = bg.color || (d.theme === "dark" ? "#12152a" : "#ffffff");
  let layer: ReactNode = null;
  let fill: string | undefined;
  if (bg.kind === "solid") fill = base;
  else if (bg.kind === "gradient") fill = `linear-gradient(${bg.angle}deg, ${base}, ${bg.color2 || p.accent})`;
  else if (bg.kind === "pattern") {
    fill = base;
    // eslint-disable-next-line @next/next/no-img-element
    layer = <img src={patternSvg(bg.pattern, width, height, rgba(p.accent, 0.16), f.u)} alt="" width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }} />;
  } else if (bg.kind === "image") {
    fill = base;
    const img = await assetData(ctx.project.id, bg.assetId, "background");
    if (img) {
      layer = (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt="" width={width} height={height} style={{ position: "absolute", top: 0, left: 0, width, height, objectFit: "cover" }} />
          <div style={{ position: "absolute", top: 0, left: 0, width, height, background: `rgba(8,10,20,${bg.dim / 100})`, display: "flex" }} />
        </>
      );
    }
  }

  const [h, v] = [d.logo.position.split("-")[1], d.logo.position.split("-")[0]];
  const logo = logoUrl ? (
    <div
      style={{
        position: "absolute",
        display: "flex",
        [v]: f.pad * (f.banner ? 0.6 : 0.8),
        left: h === "left" ? f.pad : 0,
        right: h === "right" ? f.pad : 0,
        justifyContent: h === "center" ? "center" : h === "right" ? "flex-end" : "flex-start",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoUrl} alt="" height={logoH} style={{ height: logoH, objectFit: "contain" }} />
    </div>
  ) : null;

  const chosen = SHARE_FONTS.find((x) => x.id === d.font) ?? SHARE_FONTS[0];
  const fonts = (
    await Promise.all(
      [...new Set([chosen, SHARE_FONTS[0]])].map(async (x) => {
        const data = await fontData(x.file);
        return data ? { name: x.label, data, weight: 400 as const, style: "normal" as const } : null;
      }),
    )
  ).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const family = fonts.some((x) => x.name === chosen.label) ? chosen.label : SHARE_FONTS[0].label;

  const res = new ImageResponse(
    (
      <div style={{ width, height, display: "flex", position: "relative", background: fill, fontFamily: family, color: p.ink }}>
        {layer}
        <Template cards={cards} p={p} f={f} d={d} />
        {logo}
      </div>
    ),
    { width, height, fonts },
  );
  return new Uint8Array(await res.arrayBuffer());
}

/** PNG to JPEG with ffmpeg (already the media pipeline's tool), reading and writing pipes only. */
export async function pngToJpeg(png: Uint8Array): Promise<Uint8Array> {
  if (!(await ffmpegAvailable())) throw new ShareError(501, "JPEG export needs ffmpeg on the server. PNG works without it.");
  return new Promise((resolve, reject) => {
    const child = spawn(env.ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "png_pipe", "-i", "pipe:0", "-frames:v", "1", "-q:v", "2", "-f", "mjpeg", "pipe:1"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && out.length) resolve(new Uint8Array(Buffer.concat(out)));
      else reject(new Error(`ffmpeg couldn't make the JPEG: ${err.trim().slice(-200)}`));
    });
    child.stdin.end(Buffer.from(png));
  });
}

/** One image in the format asked for. */
export async function renderShare(spec: RenderSpec, ctx: RenderContext, format: ShareFormat): Promise<{ bytes: Uint8Array; mime: string; ext: string }> {
  if (format === "jpeg") return { bytes: await pngToJpeg(await renderPng(spec, ctx, { opaque: true })), mime: "image/jpeg", ext: "jpg" };
  return { bytes: await renderPng(spec, ctx), mime: "image/png", ext: "png" };
}
