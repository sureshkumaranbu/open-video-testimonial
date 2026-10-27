import { z } from "zod";
import { parseJson } from "../html";
import { ImporterInputError, type ImportedReview, type ImporterAdapter } from "../types";
import { reviewsFromCsv } from "./_csv";
import { listOf, reviewFromObject } from "./_json";

/**
 * Moving from Shapo: their API with the owner's own key
 * (GET https://api.shapo.io/testimonials, paged). Shapo has no export
 * button (checked 2026-10-27), so the CSV upload is only for a file the
 * owner made themselves. Video links come across when the API has them,
 * through import.media.
 * Whether Shapo counts pages from 0 or 1 isn't documented, so we start at
 * 0 and skip a page that repeats the one before.
 */

const PAGE_SIZE = 50;
const MAX_PAGES = 21;

const input = z.object({ apiKey: z.string().trim().min(10, "Paste your Shapo API key, or upload a CSV export instead").max(500) });
type Input = z.output<typeof input>;

export function parseShapo(json: unknown): ImportedReview[] {
  return listOf(json)
    .map((o) => reviewFromObject(o))
    .filter((r): r is ImportedReview => r !== null);
}

/** Cursor "<page>|<first id of the page before>". */
function readCursor(cursor: string | null) {
  if (!cursor) return { page: 0, prev: "" };
  const [p, ...rest] = cursor.split("|");
  return { page: Math.max(0, Number(p) || 0), prev: rest.join("|") };
}

export const shapo: ImporterAdapter = {
  id: "shapo",
  label: "Shapo",
  platform: "shapo",
  kind: "migration",
  method: "api-key",
  tosNotes: "Uses Shapo’s API with your own key (Shapo’s free plan shares only your 15 newest testimonials). The key is used for this import only and isn’t kept afterwards.",
  fields: [{ key: "apiKey", label: "Shapo API key", type: "password", optional: true, hint: "In Shapo: Settings → General → API Key. Shapo has no export button, so the key is the way to bring everything across." }],
  input,
  upload: { accept: ".csv,text/csv", label: "Or upload a CSV you made from Shapo" },
  async fetchPage(raw, cursor, ctx) {
    const { apiKey } = raw as Input;
    const { page, prev } = readCursor(cursor);
    const url = `${ctx.origin("https://api.shapo.io")}/testimonials?size=${PAGE_SIZE}&page=${page}&sort=newest`;
    const res = await ctx.fetchText(url, { headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" }, timeoutMs: 15_000, maxBytes: 10 * 1024 * 1024 });
    if (res.status === 401 || res.status === 403) throw new ImporterInputError("Shapo didn't accept that API key. Copy it again from Shapo, or upload a CSV.");
    if (res.status === 429) throw new Error("Shapo is limiting requests (60 an hour); try again later");
    const json = parseJson(res.text);
    if (res.status !== 200 || json === undefined) throw new Error(`Shapo answered ${res.status}`);
    const rows = listOf(json);
    const items = parseShapo(rows);
    const first = items[0]?.sourceReviewId ?? "";
    const more = rows.length >= PAGE_SIZE && page + 1 < MAX_PAGES;
    const next = more ? `${page + 1}|${first}` : null;
    // Page 0 and page 1 were the same page: carry on without repeating it.
    if (first && first === prev) return { items: [], next };
    return { items, next };
  },
  parseFile: (text) => reviewsFromCsv(text),
};
