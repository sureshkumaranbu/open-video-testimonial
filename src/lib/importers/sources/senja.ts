import { z } from "zod";
import { parseJson } from "../html";
import { ImporterInputError, type ImportedReview, type ImporterAdapter } from "../types";
import { reviewsFromCsv, senjaDate } from "./_csv";
import { listOf, reviewFromObject } from "./_json";

/**
 * Moving from Senja: their REST API with the owner's own API key
 * (GET https://api.senja.io/v1/testimonials, paged), or their CSV export.
 * Text, ratings, the review site each one came from, avatars and videos
 * come across; videos are downloaded through import.media.
 */

const PAGE_SIZE = 50;
const MAX_PAGES = 20;

const input = z.object({ apiKey: z.string().trim().min(10, "Paste your Senja API key, or upload the CSV export instead").max(500) });
type Input = z.output<typeof input>;

export function parseSenja(json: unknown): ImportedReview[] {
  return listOf(json)
    .map((o) => reviewFromObject(o, { date: senjaDate, title: "headline" }))
    .filter((r): r is ImportedReview => r !== null);
}

export const senja: ImporterAdapter = {
  id: "senja",
  label: "Senja",
  platform: "senja",
  kind: "migration",
  method: "api-key",
  tosNotes: "Uses Senja’s API with your own key (Senja’s paid plans), or the CSV you export from Senja. The key is used for this import only and isn’t kept afterwards.",
  fields: [{ key: "apiKey", label: "Senja API key", type: "password", optional: true, hint: "In Senja: Automate → API. Or leave this empty and upload the CSV export." }],
  input,
  upload: { accept: ".csv,text/csv", label: "Upload the Senja CSV export" },
  async fetchPage(raw, cursor, ctx) {
    const { apiKey } = raw as Input;
    const page = cursor ? Math.max(1, Number(cursor) || 1) : 1;
    const url = `${ctx.origin("https://api.senja.io")}/v1/testimonials?limit=${PAGE_SIZE}&page=${page}&sort=date&order=desc`;
    const res = await ctx.fetchText(url, { headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" }, timeoutMs: 15_000, maxBytes: 10 * 1024 * 1024 });
    if (res.status === 401 || res.status === 403) throw new ImporterInputError("Senja didn't accept that API key. Copy it again from Senja, or upload the CSV export.");
    const json = parseJson(res.text);
    if (res.status !== 200 || json === undefined) throw new Error(`Senja answered ${res.status}`);
    const rows = listOf(json);
    const items = parseSenja(rows);
    return { items, next: rows.length >= PAGE_SIZE && page < MAX_PAGES ? String(page + 1) : null };
  },
  parseFile: (text) => reviewsFromCsv(text, { senjaDates: true }),
};
