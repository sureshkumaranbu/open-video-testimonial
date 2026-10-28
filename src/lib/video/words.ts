import { parseVtt } from "../captions";

/**
 * Word timings for burned-in captions (VID-07) and for choosing a reel clip
 * by selecting transcript text (VID-08). Captions give times per cue, not
 * per word, so each cue's time is shared out over its words by their length:
 * close enough for captions that follow speech, and for in and out points
 * the owner can still nudge. Client-safe: the reel editor uses it too.
 */
export type Word = { text: string; start: number; end: number };

/** The longest a single word may stay on screen when spread over a quiet cue. */
const MAX_WORD_SECONDS = 1.6;

function share(text: string, start: number, end: number): Word[] {
  const parts = text
    .replace(/<[^>]*>/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (!parts.length || !(end > start)) return [];
  const weights = parts.map((w) => w.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const out: Word[] = [];
  let at = start;
  parts.forEach((w, i) => {
    const len = ((end - start) * weights[i]) / total;
    out.push({ text: w, start: round(at), end: round(Math.min(at + len, at + MAX_WORD_SECONDS)) });
    at += len;
  });
  return out;
}

const round = (s: number) => Math.round(s * 1000) / 1000;

/** Every word of a WebVTT file, in order, with the times its cue gives it. */
export function wordsFromVtt(vtt: string): Word[] {
  return parseVtt(vtt).flatMap((c) => share(c.text, c.start, c.end));
}

/** A transcript without captions: its words spread evenly over the video. */
export function wordsFromText(text: string, durationSec: number): Word[] {
  return share(text, 0, durationSec);
}

/** The words inside [from, to) seconds, moved so `from` is 0. A word cut by an edge keeps the part inside. */
export function wordsBetween(words: Word[], from: number, to: number | null): Word[] {
  const stop = to ?? Infinity;
  return words
    .filter((w) => w.end > from && w.start < stop)
    .map((w) => ({ text: w.text, start: round(Math.max(0, w.start - from)), end: round(Math.min(stop, w.end) - from) }));
}

/**
 * VID-08: the clip that a selection of words covers, in whole milliseconds:
 * from the first chosen word's start to the last one's end (either order).
 */
export function rangeOfWords(words: Word[], a: number, b: number): { startMs: number; endMs: number } | null {
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(words.length - 1, Math.max(a, b));
  if (!words.length || lo > hi) return null;
  return { startMs: Math.floor(words[lo].start * 1000), endMs: Math.ceil(words[hi].end * 1000) };
}

/** Groups words into the lines shown together, `per` at a time, never across a long pause. */
export function captionLines(words: Word[], per: number): Word[][] {
  const lines: Word[][] = [];
  let line: Word[] = [];
  for (const w of words) {
    const gap = line.length ? w.start - line[line.length - 1].end : 0;
    if (line.length >= per || gap > 1) {
      lines.push(line);
      line = [];
    }
    line.push(w);
  }
  if (line.length) lines.push(line);
  return lines;
}
