import zlib from "node:zlib";
import { Parser } from "htmlparser2";

/**
 * A small reader for .xlsx spreadsheets (IMP-04), so a spreadsheet goes
 * through the same column mapper as a CSV without a new dependency. It reads
 * the zip's central directory, inflates only the parts it needs (the
 * workbook, its relationships, shared strings, styles and the first
 * worksheet) and turns cells into text: shared and inline strings, numbers,
 * booleans, and dates from the 1900 (or 1904) serial when the cell's number
 * format is a date. Formulas give their last saved value.
 *
 * Every limit is checked while reading, so a hostile file can't exhaust the
 * server: the file size, each part's inflated size (checked by zlib as it
 * inflates, whatever the header claims), the inflate ratio, the total, and
 * the rows and columns kept.
 */

export const XLSX_MAX_FILE_BYTES = 20 * 1024 * 1024;
/** The most one part may inflate to. */
export const XLSX_MAX_PART_BYTES = 64 * 1024 * 1024;
/** All the parts read, together. */
export const XLSX_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
/** Inflated bytes per compressed byte; real spreadsheets stay far below this. */
export const XLSX_MAX_RATIO = 200;
/** A header row plus the CSV import's 10,000 rows. */
export const XLSX_MAX_ROWS = 10_001;
export const XLSX_MAX_COLS = 100;
/** Excel's own limit for one cell. */
export const XLSX_MAX_CELL_CHARS = 32_767;
/**
 * All the text kept, together. Shared strings are stored once but may be
 * used by every cell, so the inflate caps alone don't bound the output.
 */
export const XLSX_MAX_TEXT_CHARS = 32 * 1024 * 1024;

export class XlsxError extends Error {}

type Entry = { name: string; method: number; compressed: number; size: number; offset: number };

const sig = (b: Buffer, at: number, n: number) => b.length >= at + 4 && b.readUInt32LE(at) === n;

/** A zip's file list, from the end-of-central-directory record. */
function centralDirectory(buf: Buffer): Map<string, Entry> {
  if (!sig(buf, 0, 0x04034b50)) throw new XlsxError("That isn't an .xlsx file (it isn't a zip archive)");
  // The end record is in the last 22 + 65,535 bytes (its comment can be that long).
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (sig(buf, i, 0x06054b50)) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new XlsxError("The spreadsheet is damaged (no zip directory)");
  const count = buf.readUInt16LE(end + 10);
  const dirSize = buf.readUInt32LE(end + 12);
  const dirStart = buf.readUInt32LE(end + 16);
  if (count === 0xffff || dirStart === 0xffffffff) throw new XlsxError("Spreadsheets this large (zip64) aren't supported. Save it as CSV instead.");
  if (dirStart + dirSize > end || count > 10_000) throw new XlsxError("The spreadsheet is damaged (bad zip directory)");
  const out = new Map<string, Entry>();
  let p = dirStart;
  for (let i = 0; i < count; i++) {
    if (!sig(buf, p, 0x02014b50)) throw new XlsxError("The spreadsheet is damaged (bad zip entry)");
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    out.set(name, { name, method, compressed, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Inflates one part, never past the caps (zlib stops at maxOutputLength, whatever the header says). */
function readPart(buf: Buffer, e: Entry, budget: { left: number }): string {
  if (!sig(buf, e.offset, 0x04034b50)) throw new XlsxError("The spreadsheet is damaged (bad zip entry)");
  const nameLen = buf.readUInt16LE(e.offset + 26);
  const extraLen = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  if (start + e.compressed > buf.length) throw new XlsxError("The spreadsheet is damaged (a part is cut short)");
  const data = buf.subarray(start, start + e.compressed);
  const limit = Math.min(XLSX_MAX_PART_BYTES, budget.left, Math.max(64 * 1024, e.compressed * XLSX_MAX_RATIO));
  let out: Buffer;
  if (e.method === 0) {
    if (data.length > limit) throw new XlsxError("The spreadsheet is too large to read here. Save it as CSV, or split it.");
    out = data;
  } else if (e.method === 8) {
    try {
      out = zlib.inflateRawSync(data, { maxOutputLength: limit });
    } catch (err) {
      if ((err as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|larger than/i.test((err as Error).message)) {
        throw new XlsxError("The spreadsheet is too large to read here. Save it as CSV, or split it.");
      }
      throw new XlsxError("The spreadsheet is damaged (a part can't be unpacked)");
    }
  } else {
    throw new XlsxError("The spreadsheet uses a compression this reader doesn't know. Save it as CSV instead.");
  }
  budget.left -= out.length;
  return out.toString("utf8");
}

/** Runs an XML string through htmlparser2 in XML mode. */
function walkXml(xml: string, h: { open?: (name: string, attrs: Record<string, string>) => void; text?: (t: string) => void; close?: (name: string) => void }) {
  const p = new Parser(
    {
      onopentag: (name, attrs) => h.open?.(local(name), attrs),
      ontext: (t) => h.text?.(t),
      onclosetag: (name) => h.close?.(local(name)),
    },
    { xmlMode: true, decodeEntities: true },
  );
  p.write(xml);
  p.end();
}

/** "x:sheet" and "sheet" alike. */
const local = (name: string) => name.slice(name.indexOf(":") + 1);

function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  let cur: string | null = null;
  let inT = false;
  let phonetic = 0;
  walkXml(xml, {
    open: (n) => {
      if (n === "si") cur = "";
      else if (n === "rPh") phonetic++;
      else if (n === "t" && !phonetic) inT = true;
    },
    text: (t) => {
      if (inT && cur !== null) cur += t;
    },
    close: (n) => {
      if (n === "t") inT = false;
      else if (n === "rPh") phonetic--;
      else if (n === "si" && cur !== null) {
        out.push(cur);
        cur = null;
      }
    },
  });
  return out;
}

/** Built-in number formats that are dates or times (ECMA-376 §18.8.30). */
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** Whether a custom format code shows a date: d, m, y, h or s outside quotes, brackets and escapes. */
export function isDateFormat(code: string) {
  const bare = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "").replace(/_./g, "");
  return /[dmyhs]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare);
}

/** Which cell styles (by index) are dates. */
function dateStyles(xml: string | null): Set<number> {
  const out = new Set<number>();
  if (!xml) return out;
  const custom = new Map<number, string>();
  let inXfs = false;
  let xf = 0;
  walkXml(xml, {
    open: (n, a) => {
      if (n === "numFmt") custom.set(Number(a.numFmtId), a.formatCode ?? "");
      else if (n === "cellXfs") inXfs = true;
      else if (n === "xf" && inXfs) {
        const id = Number(a.numFmtId ?? 0);
        if (DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))) out.add(xf);
        xf++;
      }
    },
    close: (n) => {
      if (n === "cellXfs") inXfs = false;
    },
  });
  return out;
}

const DAY_MS = 86_400_000;

/**
 * A date serial as text: "2026-10-27", or "2026-10-27 14:30" with a time.
 * The 1900 system counts the non-existent 29 Feb 1900, so serials from
 * 1 Mar 1900 on are one day ahead of the real calendar.
 */
export function serialToDate(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null;
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const days = !date1904 && serial >= 60 ? serial - 1 : serial;
  const ms = Math.round(base + days * DAY_MS);
  const d = new Date(ms);
  const iso = d.toISOString();
  const hasTime = Math.abs(serial - Math.floor(serial)) > 1e-9;
  return hasTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

/** "AB12" → 27 (0-based column). */
function columnOf(ref: string | undefined): number | null {
  const m = /^([A-Z]{1,3})\d*$/i.exec(ref ?? "");
  if (!m) return null;
  let n = 0;
  for (const c of m[1].toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Numbers as a person would type them: no float noise ("0.1+0.2"), no exponent for ordinary sizes. */
function numberText(raw: string) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return String(Number.parseFloat(n.toPrecision(15)));
}

function firstSheetPath(workbook: string | null, rels: string | null): { path: string; date1904: boolean } {
  let rid: string | null = null;
  let date1904 = false;
  if (workbook) {
    walkXml(workbook, {
      open: (n, a) => {
        if (n === "sheet" && rid === null) rid = a["r:id"] ?? Object.entries(a).find(([k]) => /(^|:)id$/.test(k))?.[1] ?? null;
        if (n === "workbookPr" && (a.date1904 === "1" || a.date1904 === "true")) date1904 = true;
      },
    });
  }
  let target: string | null = null;
  if (rels && rid) {
    walkXml(rels, {
      open: (n, a) => {
        if (n === "Relationship" && a.Id === rid) target = a.Target ?? null;
      },
    });
  }
  if (!target) return { path: "xl/worksheets/sheet1.xml", date1904 };
  const t = target as string;
  const path = t.startsWith("/") ? t.slice(1) : t.startsWith("xl/") ? t : `xl/${t.replace(/^\.\//, "")}`;
  return { path, date1904 };
}

export type Sheet = { rows: string[][]; truncated: boolean };

/** The first worksheet of an .xlsx file as rows of text (empty rows dropped). */
export function readXlsx(input: Uint8Array): Sheet {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buf.length > XLSX_MAX_FILE_BYTES) throw new XlsxError("That file is larger than 20 MB");
  const dir = centralDirectory(buf);
  const budget = { left: XLSX_MAX_TOTAL_BYTES };
  const part = (name: string) => {
    const e = dir.get(name);
    return e ? readPart(buf, e, budget) : null;
  };
  const { path, date1904 } = firstSheetPath(part("xl/workbook.xml"), part("xl/_rels/workbook.xml.rels"));
  const sheetXml = part(path);
  if (!sheetXml) throw new XlsxError("The spreadsheet has no worksheet we can read");
  const strings = sharedStrings(part("xl/sharedStrings.xml"));
  const dates = dateStyles(part("xl/styles.xml"));

  const rows: string[][] = [];
  let truncated = false;
  let chars = 0;
  let row: string[] | null = null;
  let col = 0;
  let cell: { col: number; type: string; style: number } | null = null;
  let value = "";
  let inline = "";
  let into: "v" | "t" | null = null;
  walkXml(sheetXml, {
    open: (n, a) => {
      if (n === "row") {
        row = [];
        col = 0;
      } else if (n === "c" && row) {
        const c = columnOf(a.r) ?? col;
        cell = { col: c, type: a.t ?? "n", style: Number(a.s ?? 0) };
        value = "";
        inline = "";
        col = c + 1;
      } else if (n === "v" && cell) into = "v";
      else if (n === "t" && cell) into = "t";
    },
    text: (t) => {
      if (into === "v") value += t;
      else if (into === "t") inline += t;
    },
    close: (n) => {
      if (n === "v" || n === "t") into = null;
      else if (n === "c" && cell && row) {
        const c: { col: number; type: string; style: number } = cell;
        cell = null;
        if (c.col >= XLSX_MAX_COLS) {
          truncated = true;
          return;
        }
        let text: string;
        if (c.type === "s") text = strings[Number(value)] ?? "";
        else if (c.type === "inlineStr") text = inline;
        else if (c.type === "str" || c.type === "e") text = value;
        else if (c.type === "b") text = value === "1" ? "TRUE" : "FALSE";
        else if (value === "") text = "";
        else if (dates.has(c.style)) text = serialToDate(Number(value), date1904) ?? numberText(value);
        else text = numberText(value);
        if (text.length > XLSX_MAX_CELL_CHARS) text = text.slice(0, XLSX_MAX_CELL_CHARS);
        chars += text.length;
        if (chars > XLSX_MAX_TEXT_CHARS) throw new XlsxError("The spreadsheet is too large to read here. Save it as CSV, or split it.");
        while (row.length < c.col) row.push("");
        row[c.col] = text;
      } else if (n === "row" && row) {
        const r: string[] = row;
        row = null;
        if (!r.some((v) => v.trim() !== "")) return;
        if (rows.length >= XLSX_MAX_ROWS) {
          truncated = true;
          return;
        }
        rows.push(r);
      }
    },
  });
  return { rows, truncated };
}

/** Rows as CSV text for the column mapper: every field quoted and kept as it is (no formula guard: it only goes back into the mapper, never into a file). */
export function rowsToCsv(rows: string[][]) {
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => Array.from({ length: width }, (_, i) => `"${(r[i] ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n";
}

/** Whether these bytes start like a zip (an .xlsx is one). */
export function looksLikeXlsx(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
