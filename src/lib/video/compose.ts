import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { relativeLuminance, textOn } from "../contrast";
import { env } from "../env";
import { ffmpegSeconds } from "../media";
import { captionLines, type Word } from "./words";

/**
 * The ffmpeg side of M16's renders: one "segment" at a time (a card or a
 * clip with its overlays), every segment encoded alike so they can be joined
 * without re-encoding, then an optional music bed underneath.
 *
 * Safety, as in src/lib/media.ts: argument arrays and no shell; inputs only
 * through the file protocol. ffmpeg runs inside a scratch folder, and every
 * file a filter graph names (the font, text, captions) sits in it under a
 * name we chose, so no path and no user text is ever part of a filter graph.
 * Text is read from files (drawtext `textfile` with expansion off, an ASS
 * file for captions); colours are checked hex; times and sizes are integers.
 */

export type Canvas = { w: number; h: number };
export const FPS = 30;

const SAFE_INPUT = ["-protocol_whitelist", "file"];
const threads = String(Math.max(1, Math.min(os.cpus().length - 1, 4)));

/** Every segment is encoded alike, so the concat demuxer can join them with -c copy. */
const ENCODE = [
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-r", String(FPS),
  "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
  "-video_track_timescale", "15360", "-movflags", "+faststart", "-threads", threads,
];

/** Runs ffmpeg in `cwd`, killed after `timeoutMs`. Errors carry the last lines ffmpeg printed. */
export function runFfmpeg(args: string[], o: { cwd: string; timeoutMs: number }) {
  return new Promise<void>((resolve, reject) => {
    execFile(
      env.ffmpegPath,
      ["-nostdin", "-hide_banner", "-loglevel", "error", ...args],
      { cwd: o.cwd, timeout: o.timeoutMs, maxBuffer: 8 * 1024 * 1024, killSignal: "SIGKILL" },
      (err, _out, stderr) => {
        if (!err) return resolve();
        const timedOut = (err as { killed?: boolean }).killed;
        const detail = String(stderr || err.message).trim().split("\n").slice(-3).join(" ");
        reject(new Error(timedOut ? "Rendering took too long and was stopped" : `ffmpeg failed: ${detail}`));
      },
    );
  });
}

/** How long one ffmpeg run may take: generous for slow servers, but never unbounded. */
export function timeoutFor(durationMs: number) {
  return Math.min(10 * 60_000, Math.max(2 * 60_000, durationMs * 6));
}

/** The OFL Geist font that ships for share images; the only font burned into videos. */
const FONT = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "fonts", "og", "Geist-Regular.ttf");

/** A scratch folder under DATA_DIR/tmp holding the font as font.ttf; removed afterwards, whatever happens. */
export async function withWorkDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  await fs.promises.mkdir(env.tmpDir, { recursive: true });
  const dir = await fs.promises.mkdtemp(path.join(/*turbopackIgnore: true*/ env.tmpDir, "render-"));
  try {
    await fs.promises.copyFile(FONT(), path.join(/*turbopackIgnore: true*/ dir, "font.ttf"));
    return await fn(dir);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

/** `#0f766e` → `0x0f766e` for ffmpeg; anything else is refused. */
export function ffColor(hex: string, alpha?: number) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Invalid colour: ${hex}`);
  const a = alpha === undefined ? "" : `@${Math.max(0, Math.min(1, alpha)).toFixed(2)}`;
  return `0x${hex.slice(1).toLowerCase()}${a}`;
}

/** `#RRGGBB` → ASS's `&HAABBGGRR` (alpha 0 is opaque). */
export function assColor(hex: string, alpha = 0) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Invalid colour: ${hex}`);
  const h = hex.slice(1).toUpperCase();
  const a = Math.round(Math.max(0, Math.min(255, alpha)))
    .toString(16)
    .toUpperCase()
    .padStart(2, "0");
  return `&H${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`;
}

/** Mixes a colour with white (`amount` 0..1), for a highlight that stays readable on dark video. */
export function lighten(hex: string, amount: number) {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[n(1), n(3), n(5)].map((c) => mix(c).toString(16).padStart(2, "0")).join("")}`;
}

/** A colour that reads on dark footage: the brand colour, lifted when it's too dark. */
export function highlightOf(brand: string) {
  const l = relativeLuminance(brand) ?? 0;
  return l >= 0.2 ? brand : lighten(brand, l < 0.05 ? 0.55 : 0.35);
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const int = (n: number) => Math.round(n);

/** Plain text safe for a drawtext file and an ASS line: no control characters, no override braces or backslashes. */
export function cleanText(text: string, max = 300) {
  return text
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[{}]/g, (c) => (c === "{" ? "(" : ")"))
    .replace(/\\/g, "/")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Breaks text into lines of about `chars` characters (Geist averages a little over half its size per character). */
export function wrap(text: string, chars: number, maxLines: number) {
  const words = cleanText(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && (line + " " + w).length > chars) {
      lines.push(line);
      line = "";
    }
    line = line ? `${line} ${w}` : w.slice(0, chars);
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[\s.,;:!?]+$/, "")}…`;
    return kept;
  }
  return lines;
}

// ------------------------------------------------------------------ segments

/** Something drawn over the picture. Text is written to a file and drawn from there. */
export type Layer =
  | { type: "box"; x: number; y: number; w: number; h: number; color: string; alpha?: number }
  | { type: "text"; text: string; x: number | "center"; y: number; size: number; color: string }
  | { type: "logo"; file: string; x: number | "right"; y: number; h: number; margin?: number }
  | { type: "captions"; ass: string };

export type Fit = "cover" | "contain" | "blur" | { box: { x: number; y: number; w: number; h: number } };

export type Segment = {
  canvas: Canvas;
  durationMs: number;
  /** The fill behind a card, letterboxing or a framed video. */
  background: string;
  video?: { file: string; startMs: number; hasAudio: boolean; fit: Fit };
  layers: Layer[];
  /** Fade from and to black at the ends, in ms (cards). */
  fadeMs?: number;
};

/**
 * Renders one segment to `out` (a name inside `dir`). Inputs: the video (or a
 * colour source for a card), silence when there's no sound, and any logos.
 */
export async function renderSegment(dir: string, seg: Segment, out: string) {
  const { w: W, h: H } = seg.canvas;
  const sec = ffmpegSeconds(Math.max(1, Math.round(seg.durationMs)));
  const args: string[] = [];
  const graph: string[] = [];
  let input = 0;
  let audio = "";
  let cur = "";
  let chain: string[] = [];
  let label = 0;
  const flush = () => {
    const next = `s${label++}`;
    graph.push(`${cur}${chain.length ? chain.join(",") : "null"}[${next}]`);
    cur = `[${next}]`;
    chain = [];
  };

  if (seg.video) {
    args.push(...SAFE_INPUT, "-ss", ffmpegSeconds(Math.max(0, Math.round(seg.video.startMs))), "-i", seg.video.file);
    const v = input++;
    const fit = seg.video.fit;
    const bg = ffColor(seg.background);
    if (fit === "cover") {
      cur = `[${v}:v]`;
      chain.push(`scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`);
    } else if (fit === "contain") {
      cur = `[${v}:v]`;
      chain.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${bg}`);
    } else if (fit === "blur") {
      graph.push(
        `[${v}:v]split[bga][bgb]`,
        `[bga]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:2,eq=brightness=-0.12[bgblur]`,
        `[bgb]scale=${W}:${H}:force_original_aspect_ratio=decrease[bgfront]`,
      );
      cur = "[bgblur][bgfront]";
      chain.push("overlay=(W-w)/2:(H-h)/2");
    } else {
      const b = fit.box;
      cur = `[${v}:v]`;
      chain.push(`scale=${even(b.w)}:${even(b.h)}:force_original_aspect_ratio=decrease`, `pad=${W}:${H}:${int(b.x)}+(${even(b.w)}-iw)/2:${int(b.y)}+(${even(b.h)}-ih)/2:color=${bg}`);
    }
    chain.push("setsar=1", `fps=${FPS}`);
    if (seg.video.hasAudio) {
      audio = `[${v}:a]`;
    } else {
      args.push("-f", "lavfi", "-t", sec, "-i", "anullsrc=r=48000:cl=stereo");
      audio = `[${input++}:a]`;
    }
  } else {
    args.push("-f", "lavfi", "-i", `color=c=${ffColor(seg.background)}:s=${W}x${H}:r=${FPS}:d=${sec}`);
    cur = `[${input++}:v]`;
    args.push("-f", "lavfi", "-t", sec, "-i", "anullsrc=r=48000:cl=stereo");
    audio = `[${input++}:a]`;
  }

  let files = 0;
  for (const layer of seg.layers) {
    if (layer.type === "box") {
      chain.push(`drawbox=x=${int(layer.x)}:y=${int(layer.y)}:w=${int(layer.w)}:h=${int(layer.h)}:color=${ffColor(layer.color, layer.alpha ?? 1)}:t=fill`);
    } else if (layer.type === "text") {
      const text = cleanText(layer.text, 200);
      if (!text) continue;
      const name = `t${files++}.txt`;
      await fs.promises.writeFile(path.join(/*turbopackIgnore: true*/ dir, name), text, "utf8");
      const x = layer.x === "center" ? "(w-text_w)/2" : String(int(layer.x));
      chain.push(`drawtext=fontfile=font.ttf:textfile=${name}:expansion=none:fontsize=${int(layer.size)}:fontcolor=${ffColor(layer.color)}:x=${x}:y=${int(layer.y)}`);
    } else if (layer.type === "logo") {
      args.push(...SAFE_INPUT, "-i", layer.file);
      const l = input++;
      flush();
      graph.push(`[${l}:v]scale=-2:${even(layer.h)},format=rgba[logo${l}]`);
      const x = layer.x === "right" ? `W-w-${int(layer.margin ?? 40)}` : String(int(layer.x));
      cur = `${cur}[logo${l}]`;
      chain.push(`overlay=${x}:${int(layer.y)}:eof_action=repeat`);
    } else {
      const name = `c${files++}.ass`;
      await fs.promises.writeFile(path.join(/*turbopackIgnore: true*/ dir, name), layer.ass, "utf8");
      chain.push(`ass=${name}:fontsdir=.`);
    }
  }
  if (seg.fadeMs) {
    const f = (seg.fadeMs / 1000).toFixed(3);
    const outAt = ((Math.max(seg.durationMs - seg.fadeMs, 0)) / 1000).toFixed(3);
    chain.push(`fade=t=in:st=0:d=${f}`, `fade=t=out:st=${outAt}:d=${f}`);
  }
  chain.push("format=yuv420p");
  graph.push(`${cur}${chain.join(",")}[vout]`);
  graph.push(`${audio}aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[aout]`);

  await runFfmpeg(
    [...args, "-filter_complex", graph.join(";"), "-map", "[vout]", "-map", "[aout]", "-t", sec, ...ENCODE, "-y", out],
    { cwd: dir, timeoutMs: timeoutFor(seg.durationMs) },
  );
}

/** Joins segments made by renderSegment (same encoding) without re-encoding. */
export async function joinSegments(dir: string, names: string[], out: string, totalMs: number) {
  if (names.some((n) => !/^[a-z0-9_-]+\.mp4$/.test(n))) throw new Error("Invalid segment name");
  await fs.promises.writeFile(path.join(/*turbopackIgnore: true*/ dir, "list.txt"), names.map((n) => `file '${n}'`).join("\n") + "\n", "utf8");
  await runFfmpeg([...SAFE_INPUT, "-f", "concat", "-i", "list.txt", "-c", "copy", "-movflags", "+faststart", "-y", out], {
    cwd: dir,
    timeoutMs: timeoutFor(totalMs / 4),
  });
}

/**
 * VID-08's music: an original ambient bed Plaudit synthesises itself with
 * ffmpeg's aevalsrc, so no third-party audio is involved (docs/CREDITS.md).
 * Two soft triads (C major and A minor) breathe into each other every eight
 * seconds, slightly detuned between left and right for width.
 */
export const MUSIC_BED = (() => {
  const voice = (f: number, w: string) => `sin(2*PI*${f}*t)*${w}`;
  const a = "(0.5+0.5*sin(2*PI*t/16))";
  const b = "(0.5-0.5*sin(2*PI*t/16))";
  const side = (detune: number) =>
    [
      `0.045*${voice(130.81 + detune, a)}`,
      `0.035*${voice(196.0 + detune, a)}`,
      `0.025*${voice(329.63 + detune, a)}`,
      `0.045*${voice(110.0 + detune, b)}`,
      `0.035*${voice(164.81 + detune, b)}`,
      `0.025*${voice(261.63 + detune, b)}`,
      `0.012*sin(2*PI*${(523.25 + detune).toFixed(2)}*t)*(0.5+0.5*sin(2*PI*0.25*t))`,
    ].join("+");
  return `${side(0)}|${side(0.6)}`;
})();

/** Lays the music bed under a finished video, quietly, fading in and out; the voices stay as they are. */
export async function addMusic(dir: string, input: string, out: string, totalMs: number) {
  const sec = ffmpegSeconds(Math.max(1, Math.round(totalMs)));
  const fadeAt = (Math.max(totalMs - 2500, 0) / 1000).toFixed(3);
  await runFfmpeg(
    [
      ...SAFE_INPUT, "-i", input,
      "-f", "lavfi", "-i", `aevalsrc=exprs=${MUSIC_BED}:s=48000:c=stereo:d=${sec}`,
      "-filter_complex",
      `[1:a]lowpass=f=2400,volume=0.55,afade=t=in:st=0:d=1.5,afade=t=out:st=${fadeAt}:d=2.5[bed];[0:a][bed]amix=inputs=2:duration=first:normalize=0[aout]`,
      "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart", "-y", out,
    ],
    { cwd: dir, timeoutMs: timeoutFor(totalMs / 2) },
  );
}

// ------------------------------------------------------------------ cards

export type Brand = { color: string; logo: string | null };

/** A title card: the brand colour with its title (and a smaller line under it) centred. */
export function cardSegment(canvas: Canvas, brand: Brand, title: string, subtitle: string | null, durationMs: number): Segment {
  const { w: W, h: H } = canvas;
  const fg = textOn(brand.color, "#111111");
  const narrow = W < H;
  const size = Math.round(Math.min(W, H) * (narrow ? 0.07 : 0.075));
  const chars = Math.max(12, Math.floor((W * 0.84) / (size * 0.56)));
  const lines = wrap(title, chars, 4);
  const subSize = Math.round(size * 0.55);
  const sub = subtitle ? wrap(subtitle, Math.floor((W * 0.84) / (subSize * 0.56)), 2) : [];
  const lineH = Math.round(size * 1.25);
  const subH = Math.round(subSize * 1.4);
  const block = lines.length * lineH + (sub.length ? Math.round(size * 0.6) + sub.length * subH : 0);
  let y = Math.round((H - block) / 2);
  const layers: Layer[] = [];
  // A short rule above the title, in the text colour: our own small mark for every card.
  layers.push({ type: "box", x: Math.round(W / 2 - size), y: y - Math.round(size * 0.9), w: size * 2, h: Math.max(4, Math.round(size / 10)), color: fg, alpha: 0.8 });
  for (const line of lines) {
    layers.push({ type: "text", text: line, x: "center", y, size, color: fg });
    y += lineH;
  }
  if (sub.length) y += Math.round(size * 0.6);
  for (const line of sub) {
    layers.push({ type: "text", text: line, x: "center", y, size: subSize, color: fg });
    y += subH;
  }
  if (brand.logo) {
    const h = Math.round(Math.min(W, H) * 0.08);
    layers.push({ type: "logo", file: brand.logo, x: "right", y: H - h - Math.round(h * 0.6), h, margin: Math.round(h * 0.6) });
  }
  return { canvas, durationMs, background: brand.color, layers, fadeMs: 300 };
}

// ------------------------------------------------------------------ captions

export type CaptionStyle = {
  size: number;
  /** Words shown together. */
  per: number;
  upper: boolean;
  color: string;
  active: string;
  /** Outline (or, with `box`, the band behind the line). */
  edge: string;
  edgeWidth: number;
  /** A band behind the line instead of an outline, at this opacity (0..1). */
  box?: number;
  /** ASS alignment: 2 bottom centre, 5 middle centre, 8 top centre. */
  align: 2 | 5 | 8;
  marginV: number;
  marginH: number;
  /** Underline the spoken word too (for looks where colour alone is subtle). */
  underline?: boolean;
  /** The other words at this opacity (0..1), so the spoken one stands out by more than colour. */
  dim?: number;
};

const assTime = (s: number) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

/**
 * Word-by-word captions as an ASS file: a few words on screen at a time, the
 * one being said in the highlight colour. Words go through cleanText, so a
 * transcript can't add ASS override tags.
 */
export function captionsAss(canvas: Canvas, words: Word[], style: CaptionStyle): string {
  const box = style.box !== undefined;
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${canvas.w}`,
    `PlayResY: ${canvas.h}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,Geist,${int(style.size)},${assColor(style.color, style.dim === undefined ? 0 : Math.round(255 * (1 - style.dim)))},${assColor(style.color)},${assColor(style.edge, box ? Math.round(255 * (1 - style.box!)) : 0)},${assColor("#000000", 160)},1,0,0,0,100,100,0,0,${box ? 3 : 1},${int(style.edgeWidth)},0,${style.align},${int(style.marginH)},${int(style.marginH)},${int(style.marginV)},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events: string[] = [];
  const on = `{\\c${assColor(style.active)}\\1a&H00&${style.underline ? "\\u1" : ""}}`;
  for (const line of captionLines(words, style.per)) {
    const texts = line.map((w) => {
      const t = cleanText(w.text, 60);
      return style.upper ? t.toUpperCase() : t;
    });
    line.forEach((w, i) => {
      const start = w.start;
      const end = i < line.length - 1 ? line[i + 1].start : w.end;
      if (!(end > start) || !texts[i]) return;
      const text = texts.map((t, j) => (j === i ? `${on}${t}{\\r}` : t)).join(" ");
      events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${text}`);
    });
  }
  return [...header, ...events, ""].join("\n");
}

/** A short unique name for a file in a work dir. */
export const segName = (i: number) => `seg${i}-${crypto.randomUUID().slice(0, 8)}.mp4`;
