/**
 * WebVTT helpers: just enough parsing to validate captions, turn them into a
 * plain transcript, and accept SRT files people already have.
 */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

export const MAX_VTT_CHARS = 200_000;

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/;

function seconds(stamp: string) {
  const m = TIME.exec(stamp);
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

function stamp(total: number) {
  const ms = Math.round(total * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

export function parseVtt(input: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = input.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at === -1) continue;
    const [from, to] = lines[at].split("-->");
    const start = seconds(from);
    const end = seconds(to);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const text = lines.slice(at + 1).join("\n").trim();
    if (text) cues.push({ start, end, text });
  }
  return cues;
}

export function toVtt(cues: Cue[]) {
  return ["WEBVTT", "", ...cues.map((c) => `${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`)].join("\n");
}

/** Strips cue markup (<v Speaker>, <b>, timestamps) and joins the lines. */
export function vttToText(input: string) {
  return parseVtt(input)
    .map((c) => c.text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

export class CaptionsError extends Error {}

/**
 * Accepts WebVTT or SRT and returns clean WebVTT, or throws a readable error.
 * Re-serialising drops anything that isn't a cue (styles, regions, notes).
 */
export function normaliseCaptions(input: string): string {
  const text = input.trim();
  if (text.length > MAX_VTT_CHARS) throw new CaptionsError("Captions are too long");
  if (!/^WEBVTT\b/.test(text) && !/^\d+\s*\n\s*[\d:,.]+\s*-->/.test(text)) {
    throw new CaptionsError("Captions must be WebVTT (starting with WEBVTT) or SRT");
  }
  const cues = parseVtt(text);
  if (cues.length === 0) throw new CaptionsError("No caption cues found");
  for (const c of cues) {
    if (c.end < c.start) throw new CaptionsError(`A cue ends before it starts (${stamp(c.start)})`);
  }
  return toVtt(cues);
}
