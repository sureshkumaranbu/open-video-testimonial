import { sql, type SQL } from "drizzle-orm";
import { schema } from "@/db";

const { testimonials } = schema;

/**
 * Keyword search for the inbox (INBOX-02) over the FTS5 index that migration
 * 0010 keeps current: name, email, company, title, headline, text,
 * transcript, tags and every answer.
 */

/** The most words one search looks for; the rest are ignored. */
export const MAX_SEARCH_TOKENS = 10;

/** FTS5's own operators. Inside quotes they'd be plain words, but a bare one is never what someone meant. */
const OPERATORS = new Set(["AND", "OR", "NOT", "NEAR"]);

/**
 * Turns what someone typed into a safe FTS5 query: up to 10 words, each
 * quoted and matched as a prefix (`"pric"*` finds "pricing"), all of them
 * required. Quotes, brackets, `*`, `:` and the other syntax characters are
 * dropped, so no input can make the query fail. Null when nothing is left.
 */
export function toFtsQuery(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const tokens = raw
    .normalize("NFKC")
    // Anything but letters, digits and the few marks that join a word (e-mail, o'brien, x.com) separates words.
    .replace(/[^\p{L}\p{N}\p{M}@._'-]+/gu, " ")
    .split(" ")
    .map((t) => t.replace(/^[@._'-]+|[@._'-]+$/g, ""))
    .filter((t) => t && /[\p{L}\p{N}]/u.test(t) && !OPERATORS.has(t))
    .slice(0, MAX_SEARCH_TOKENS);
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t}"*`).join(" ");
}

/** A WHERE condition: the testimonial matches the FTS query within its project. */
export function matchesSearch(projectId: string, fts: string): SQL {
  return sql`${testimonials.id} IN (
    SELECT s.testimonial_id FROM testimonials_fts
    JOIN testimonial_search s ON s.id = testimonials_fts.rowid
    WHERE testimonials_fts MATCH ${fts} AND s.project_id = ${projectId}
  )`;
}
