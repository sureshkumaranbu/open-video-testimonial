import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { apiExtras, toApi } from "./api-shape";
import { toCsv } from "./csv";
import { matchingIds, withTags, type InboxQuery } from "./inbox";
import { csvRows, type CsvKeys } from "./portability";

const { testimonials } = schema;

/**
 * INBOX-15: the current view (or the selected rows) as CSV or JSON, in the
 * view's order. CSV has the same columns as the project export, plus a
 * `custom:<key>` and `hidden:<key>` column for every field the exported rows
 * use. Rows are read and written 200 at a time, so a large export never sits
 * in memory whole. Owner-only: it includes emails and private fields.
 */

const CHUNK = 200;

/** The ids to export: the selected ones that are in this project (in the order given), or the whole view. */
export function exportIds(projectId: string, q: InboxQuery & { ids?: string[] }): string[] {
  if (!q.ids) return matchingIds(projectId, q);
  if (!q.ids.length) return [];
  const owned = new Set(
    getDb()
      .select({ id: testimonials.id })
      .from(testimonials)
      .where(and(eq(testimonials.projectId, projectId), inArray(testimonials.id, q.ids)))
      .all()
      .map((r) => r.id),
  );
  return [...new Set(q.ids)].filter((id) => owned.has(id));
}

/** Every custom and hidden field key these testimonials use, sorted, in two queries. */
function fieldKeys(ids: string[]): CsvKeys {
  const db = getDb();
  const keys = (col: typeof testimonials.customFields | typeof testimonials.hiddenFields) => {
    const set = new Set<string>();
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      for (const r of db.all<{ key: string }>(
        sql`SELECT DISTINCT j.key AS key FROM ${testimonials}, json_each(${col}) j WHERE ${inArray(testimonials.id, part)}`,
      ))
        set.add(r.key);
    }
    return [...set].sort();
  };
  return { customKeys: keys(testimonials.customFields), hiddenKeys: keys(testimonials.hiddenFields) };
}

/** Translations of these testimonials, by id (none: absent). */
function translationsOf(ids: string[]) {
  const out = new Map<string, { lang: string; headline: string | null; text: string | null; machine: boolean }[]>();
  if (!ids.length) return out;
  for (const r of getDb().select().from(schema.translations).where(inArray(schema.translations.testimonialId, ids)).all()) {
    out.set(r.testimonialId, [...(out.get(r.testimonialId) ?? []), { lang: r.lang, headline: r.headline, text: r.text, machine: r.machine }]);
  }
  return out;
}

function load(ids: string[]) {
  const rows = getDb().select().from(testimonials).where(inArray(testimonials.id, ids)).all();
  const byId = new Map(withTags(rows).map((t) => [t.id, t]));
  // Keep the export's order.
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

export function inboxExport(projectId: string, q: InboxQuery & { ids?: string[] }, format: "csv" | "json"): ReadableStream<Uint8Array> {
  const ids = exportIds(projectId, q);
  const enc = new TextEncoder();
  const keys = format === "csv" ? fieldKeys(ids) : null;
  let at = 0;
  let started = false;
  let written = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!started) {
        started = true;
        if (keys) {
          // The header row, even when nothing matches.
          controller.enqueue(enc.encode(toCsv(csvRows([], keys).headers, [])));
        } else controller.enqueue(enc.encode("["));
      }
      if (at >= ids.length) {
        if (!keys) controller.enqueue(enc.encode("]\n"));
        controller.close();
        return;
      }
      const part = ids.slice(at, at + CHUNK);
      const items = load(part);
      if (keys) {
        const { rows } = csvRows(items, keys);
        // toCsv adds a header line; each chunk only needs its rows.
        const text = toCsv([], rows);
        controller.enqueue(enc.encode(text.slice(text.indexOf("\r\n") + 2)));
      } else {
        const extras = apiExtras(part);
        const translated = translationsOf(part);
        // INBOX-13: a row with translations carries them too.
        const json = items.map((t) => {
          const tr = translated.get(t.id);
          return JSON.stringify({ ...toApi(t, extras.get(t.id)), ...(tr ? { translations: tr } : {}) });
        });
        if (json.length) controller.enqueue(enc.encode((written > 0 ? "," : "") + json.join(",")));
        written += json.length;
      }
      at += CHUNK;
    },
  });
}
