import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { Project } from "@/db/schema";
import { AiError, aiEnabled, aiForProject, aiJson } from "./ai";
import { env } from "./env";
import { sniffMime } from "./sniff";
import { splitCommand } from "./transcribe";

/**
 * IMP-07: reading a screenshot of a review (manual add's Image tab and the
 * import page). OCR_PROVIDER picks how:
 *   - "ai":      the shared AI client (src/lib/ai.ts) as a vision message,
 *                with the image as a data: URI of at most MAX_OCR_BYTES;
 *   - "command": a local program such as tesseract (OCR_COMMAND, e.g.
 *                `tesseract {input} stdout`), run like TRANSCRIBE_COMMAND:
 *                an argument array, never a shell, with a time limit; it
 *                prints the text, which is then split into quote, name and
 *                date by the heuristics below, so no image leaves the server;
 *   - "off":     the default.
 * Either way it only suggests: the owner reviews and edits every field
 * before anything is saved, and the image itself is kept as the
 * testimonial's screenshot by the manual add that follows.
 */

/** The largest screenshot read (and so sent to an AI provider). */
export const MAX_OCR_BYTES = 4 * 1024 * 1024;
const OCR_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
/** Characters of recognised text kept. */
const MAX_TEXT = 5000;
const COMMAND_TIMEOUT_MS = 60_000;

export class OcrError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** For Settings → This server, and whether the dialogs offer "Read the screenshot". */
export function ocrStatus(): { enabled: boolean; provider: "off" | "ai" | "command"; problem: string | null } {
  const provider = env.ocrProvider;
  if (provider === "command") return env.ocrCommand.trim() ? { enabled: true, provider, problem: null } : { enabled: false, provider, problem: "OCR_COMMAND isn't set" };
  if (provider === "ai") return aiEnabled() ? { enabled: true, provider, problem: null } : { enabled: false, provider, problem: "OCR_PROVIDER=ai needs AI_MODEL" };
  return { enabled: false, provider, problem: null };
}

/** Whether a project can read screenshots: OCR is on, and with "ai" the project allows AI. */
export function ocrForProject(project: Pick<Project, "aiEnabled">) {
  const s = ocrStatus();
  return s.enabled && (s.provider !== "ai" || aiForProject(project));
}

export type OcrResult = {
  /** The review's words, for the testimonial text. */
  text: string;
  name: string | null;
  /** YYYY-MM-DD when a date was found. */
  date: string | null;
  provider: "ai" | "command";
};

// ------------------------------------------------------------------ heuristics for plain OCR text

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || y < 1990 || y > 2100) return null;
  return date.toISOString().slice(0, 10);
};

/** The first date in a line: 2026-05-01, "May 1, 2026", "1 May 2026", "1st of May 2026". Numeric d/m/y is too ambiguous and is skipped. */
export function findDate(line: string): string | null {
  const m1 = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(line);
  if (m1) return iso(Number(m1[1]), Number(m1[2]), Number(m1[3]));
  const month = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
  const m2 = new RegExp(`\\b${month}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "i").exec(line);
  if (m2) return iso(Number(m2[3]), MONTHS.indexOf(m2[1].slice(0, 3).toLowerCase()) + 1, Number(m2[2]));
  const m3 = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${month},?\\s+(\\d{4})\\b`, "i").exec(line);
  if (m3) return iso(Number(m3[3]), MONTHS.indexOf(m3[2].slice(0, 3).toLowerCase()) + 1, Number(m3[1]));
  return null;
}

/** Words review sites put around a review that aren't part of it. */
const CHROME = /^(reply|like|share|helpful|report|translate|see more|read more|show more|verified( (purchase|buyer|customer))?|\d+\s*(likes?|replies|reviews?|helpful)|was this (review )?helpful\??|yes|no|edited|follow|·)$/i;

/** A line that reads like a person's name: 2 to 4 capitalised words (initials allowed), no digits, nothing after. */
function looksLikeName(line: string) {
  if (line.length > 40 || /\d|[.!?,:;"“”]$/.test(line)) return false;
  const words = line.split(/\s+/);
  return words.length >= 2 && words.length <= 4 && words.every((w) => /^(\p{Lu}[\p{L}'’-]*|\p{Lu}\.)$/u.test(w));
}

/**
 * Splits OCR text into the review's words, the reviewer's name and the date.
 * "— Jane Doe" (or "- Jane Doe") at the end wins for the name; otherwise a
 * short capitalised line near the top. Stars, buttons and counters are
 * dropped. Everything is a suggestion the owner checks.
 */
export function parseOcrText(raw: string): Omit<OcrResult, "provider"> {
  const lines = raw
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/[★☆✩✭⭐]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((l) => l && /[\p{L}\p{N}]/u.test(l) && !CHROME.test(l));
  let date: string | null = null;
  let name: string | null = null;
  const drop = new Set<number>();
  lines.forEach((l, i) => {
    const d = findDate(l);
    if (d && !date) date = d;
    // A line that is little more than the date (or "Posted on …") isn't part of the quote.
    if (d && l.replace(/\b(posted|reviewed|written|on|in|the|of|at)\b/gi, "").replace(/[\s,.:]+/g, " ").trim().split(" ").length <= 5) drop.add(i);
  });
  for (let i = lines.length - 1; i >= 0 && !name; i--) {
    const m = /^[—–-]\s*(.{2,60})$/.exec(lines[i]);
    if (m) {
      name = m[1].split(/,\s*/)[0].trim();
      drop.add(i);
    }
  }
  if (!name) {
    const at = lines.slice(0, 4).findIndex((l, i) => !drop.has(i) && looksLikeName(l));
    if (at >= 0) {
      name = lines[at];
      drop.add(at);
    }
  }
  const text = lines
    .filter((_, i) => !drop.has(i))
    .join(" ")
    .replace(/^["“'‘]+|["”'’]+$/g, "")
    .trim()
    .slice(0, MAX_TEXT);
  return { text, name, date };
}

// ------------------------------------------------------------------ providers

async function viaCommand(bytes: Buffer, mime: string): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "plaudit-ocr-"));
  const input = path.join(dir, `screenshot.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`);
  try {
    await fs.promises.writeFile(input, bytes);
    const [bin, ...args] = splitCommand(env.ocrCommand).map((a) => a.replaceAll("{input}", input));
    if (!bin) throw new OcrError(503, "OCR_COMMAND is empty");
    return await new Promise<string>((resolve, reject) => {
      execFile(bin, args, { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024, killSignal: "SIGKILL", encoding: "utf8" }, (err, out, stderr) =>
        err ? reject(new OcrError(502, `The OCR command failed: ${String(stderr || err.message).trim().slice(-300)}`)) : resolve(String(out)),
      );
    });
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

const OCR_SYSTEM = [
  "You read a screenshot of a review, testimonial, message or social post and answer with only a JSON object, no prose:",
  '{"text": string, "name": string|null, "date": "YYYY-MM-DD"|null}',
  "text is the reviewer's own words, copied exactly as written (no star ratings, buttons, counters or replies).",
  "name is the reviewer's name as shown. date is when it was posted, only if the screenshot shows a full date. Use null when you can't see it.",
].join("\n");

const ocrAnswer = z.object({
  text: z.string().trim().max(MAX_TEXT * 2).catch(""),
  name: z.string().trim().min(1).max(120).nullish().catch(null),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .catch(null),
});

/**
 * Reads one screenshot. Only PNG, JPEG and WebP up to MAX_OCR_BYTES (sniffed,
 * never trusted from the browser). OcrError 503 when OCR is off for this
 * project, 400 for a file it won't read, 502 when the provider fails.
 */
export async function readScreenshot(project: Pick<Project, "aiEnabled">, bytes: Buffer): Promise<OcrResult> {
  const status = ocrStatus();
  if (!status.enabled) throw new OcrError(503, status.problem ?? "Screenshot reading (OCR) isn't set up on this server");
  if (status.provider === "ai" && !aiForProject(project)) throw new OcrError(503, "AI is turned off for this project, so screenshots can't be read with it");
  if (!bytes.length) throw new OcrError(400, "The image file is empty");
  if (bytes.length > MAX_OCR_BYTES) throw new OcrError(400, `Screenshots up to ${MAX_OCR_BYTES / 1024 / 1024} MB can be read`);
  const mime = sniffMime(bytes.subarray(0, 16));
  if (!mime || !OCR_TYPES.has(mime)) throw new OcrError(400, "Choose a PNG, JPEG or WebP screenshot");

  if (status.provider === "command") {
    const out = await viaCommand(bytes, mime);
    return { ...parseOcrText(out.slice(0, MAX_TEXT * 4)), provider: "command" };
  }
  try {
    const a = await aiJson({
      system: OCR_SYSTEM,
      user: "Read this screenshot.",
      images: [`data:${mime};base64,${bytes.toString("base64")}`],
      schema: ocrAnswer,
      timeoutMs: 45_000,
      maxTokens: 1500,
    });
    const date = a.date && findDate(a.date) ? a.date : null;
    return { text: a.text.slice(0, MAX_TEXT), name: a.name ?? null, date, provider: "ai" };
  } catch (err) {
    if (err instanceof AiError) throw new OcrError(502, err.message);
    throw err;
  }
}
