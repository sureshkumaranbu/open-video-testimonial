import fs from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb } from "pdf-lib";
import type { PublicCaseStudy } from "./case-studies";
import { storage } from "./storage";

/**
 * SHARE-04: a case study as an A4 PDF, drawn with pdf-lib (MIT, pure
 * JavaScript, no headless browser) in the OFL Geist font that the image
 * studio already ships (public/fonts/og). Text is wrapped and flows onto as
 * many pages as it needs. Characters Geist doesn't have (emoji, scripts it
 * doesn't cover) are left out rather than drawn as boxes. The person's photo
 * goes in when it's a stored PNG or JPEG.
 */

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

let fontBytes: Promise<Buffer> | null = null;
const geist = () => (fontBytes ??= fs.promises.readFile(path.join(process.cwd(), "public", "fonts", "og", "Geist-Regular.ttf")));

type Color = ReturnType<typeof rgb>;
const hexColor = (hex: string, fallback: Color): Color => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const INK = rgb(0.09, 0.11, 0.18);
const MUTED = rgb(0.38, 0.41, 0.48);
const LINE = rgb(0.88, 0.89, 0.92);

async function storedImage(doc: PDFDocument, key: string | null | undefined): Promise<PDFImage | null> {
  if (!key || !/\.(png|jpe?g)$/i.test(key)) return null;
  try {
    const stream = await storage().read(key);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > MAX_IMAGE_BYTES) return null;
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    return /\.png$/i.test(key) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

/** The key behind a /api/media/<key> URL (the feed gives URLs). */
const keyOf = (url: string | null | undefined) => (url && url.startsWith("/api/media/") ? decodeURIComponent(url.slice("/api/media/".length).split("?")[0]) : null);

/** A cursor that writes wrapped lines down the page and starts a new page when it runs out. */
class Writer {
  page: PDFPage;
  y: number;
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private keep: (s: string) => string,
  ) {
    this.page = doc.addPage(A4);
    this.y = A4[1] - MARGIN;
  }
  get width() {
    return A4[0] - MARGIN * 2;
  }
  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN;
  }
  ensure(h: number) {
    if (this.y - h < MARGIN + 24) this.newPage();
  }
  /** Lines of `text` that fit `width` at `size`; words longer than a line are cut. */
  wrap(text: string, size: number, width = this.width): string[] {
    const out: string[] = [];
    for (const para of this.keep(text).split(/\n+/)) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (this.font.widthOfTextAtSize(next, size) <= width) line = next;
        else {
          if (line) out.push(line);
          let w = word;
          while (this.font.widthOfTextAtSize(w, size) > width && w.length > 1) {
            let cut = w.length - 1;
            while (cut > 1 && this.font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
            out.push(w.slice(0, cut));
            w = w.slice(cut);
          }
          line = w;
        }
      }
      if (line) out.push(line);
    }
    return out;
  }
  text(text: string, o: { size: number; color?: Color; gap?: number; x?: number; width?: number; lineHeight?: number }) {
    const lh = o.size * (o.lineHeight ?? 1.4);
    for (const l of this.wrap(text, o.size, o.width)) {
      this.ensure(lh);
      this.page.drawText(l, { x: o.x ?? MARGIN, y: this.y - o.size, size: o.size, font: this.font, color: o.color ?? INK });
      this.y -= lh;
    }
    this.y -= o.gap ?? 0;
  }
}

/** The case study as PDF bytes. */
export async function caseStudyPdf(cs: PublicCaseStudy): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = await geist();
  const font = await doc.embedFont(bytes, { subset: true });
  const glyphs = fontkit.create(bytes);
  // Only characters Geist can draw, so nothing turns into boxes.
  const keep = (s: string) =>
    [...s.normalize("NFC")]
      .map((ch) => (ch === "\n" || ch === " " || glyphs.hasGlyphForCodePoint(ch.codePointAt(0)!) ? ch : ch.match(/\s/) ? " " : ""))
      .join("");
  const accent = hexColor(cs.project.accentColor, rgb(0.06, 0.46, 0.43));
  doc.setTitle(keep(cs.title));
  doc.setAuthor(keep(cs.project.name));
  doc.setSubject("Customer story");
  doc.setCreator("Plaudit");
  doc.setProducer("Plaudit (pdf-lib)");

  const w = new Writer(doc, font, keep);
  const { content, item } = cs;

  // Header: the project and a rule in its colour.
  w.text(cs.project.name.toUpperCase(), { size: 9, color: accent, gap: 4 });
  w.page.drawRectangle({ x: MARGIN, y: w.y, width: 40, height: 3, color: accent });
  w.y -= 22;
  w.text(cs.title, { size: 24, lineHeight: 1.2, gap: 6 });
  if (content.summary.trim()) w.text(content.summary, { size: 12, color: MUTED, gap: 10 });

  // The customer.
  const photo = await storedImage(doc, keyOf(item.avatarUrl));
  const byline = [item.title, item.company].filter(Boolean).join(", ");
  w.ensure(48);
  let x = MARGIN;
  if (photo) {
    w.page.drawImage(photo, { x, y: w.y - 40, width: 40, height: 40 });
    x += 52;
  }
  w.page.drawText(keep(item.name), { x, y: w.y - 16, size: 12, font, color: INK });
  if (byline) w.page.drawText(keep(byline).slice(0, 90), { x, y: w.y - 32, size: 10, font, color: MUTED });
  w.y -= 58;

  // Metrics: up to four boxes in a row.
  if (content.metrics.length) {
    const n = content.metrics.length;
    const gap = 12;
    const bw = (w.width - gap * (n - 1)) / n;
    const bh = 64;
    w.ensure(bh + 16);
    content.metrics.forEach((m, i) => {
      const bx = MARGIN + i * (bw + gap);
      w.page.drawRectangle({ x: bx, y: w.y - bh, width: bw, height: bh, borderColor: LINE, borderWidth: 1 });
      w.page.drawText(keep(m.value), { x: bx + 10, y: w.y - 30, size: 20, font, color: accent });
      const label = w.wrap(m.label, 9, bw - 20).slice(0, 2);
      label.forEach((l, j) => w.page.drawText(l, { x: bx + 10, y: w.y - 46 - j * 11, size: 9, font, color: MUTED }));
    });
    w.y -= bh + 20;
  }

  // The pull quote, with a bar in the project's colour.
  if (content.pullQuote.trim()) {
    const size = 15;
    const lh = size * 1.4;
    for (const l of w.wrap(`“${content.pullQuote.trim()}”`, size, w.width - 18)) {
      w.ensure(lh);
      w.page.drawRectangle({ x: MARGIN, y: w.y - lh, width: 3, height: lh, color: accent });
      w.page.drawText(l, { x: MARGIN + 18, y: w.y - size, size, font, color: INK });
      w.y -= lh;
    }
    w.y -= 4;
    w.text(`— ${item.name}`, { size: 10, x: MARGIN + 18, color: MUTED, gap: 16 });
  }

  for (const [heading, body] of [
    ["The challenge", content.challenge],
    ["The solution", content.solution],
    ["The result", content.result],
  ] as const) {
    if (!body.trim()) continue;
    w.ensure(60);
    w.text(heading, { size: 14, color: accent, gap: 2 });
    w.text(body, { size: 10.5, lineHeight: 1.55, gap: 14 });
  }

  // A footer on every page.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const foot = `${keep(cs.project.name)} customer story${pages.length > 1 ? `  ·  ${i + 1} of ${pages.length}` : ""}`;
    p.drawLine({ start: { x: MARGIN, y: MARGIN }, end: { x: A4[0] - MARGIN, y: MARGIN }, thickness: 0.5, color: LINE });
    p.drawText(foot, { x: MARGIN, y: MARGIN - 16, size: 8, font, color: MUTED });
  });
  return doc.save();
}

/** A file name for the download: the title's words, safe everywhere. */
export function pdfFileName(title: string) {
  const base = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60)
    .toLowerCase();
  return `${base || "case-study"}.pdf`;
}
