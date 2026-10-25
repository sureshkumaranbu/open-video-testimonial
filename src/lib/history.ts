import crypto from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/db";
import type { Approver, HistoryAction, HistoryActor, TestimonialHistory } from "@/db/schema";

const { testimonialHistory } = schema;

/**
 * Edit history for each testimonial (INBOX-10): who changed what, and when.
 * Rows are only ever added, inside the same transaction as the change they
 * describe. Each diff is `{field: [before, after]}`.
 */

export type HistoryEntry = {
  testimonialId: string;
  actor: HistoryActor;
  /** The signed-in person, when there is one. */
  actorEmail?: string | null;
  action: HistoryAction;
  diff: object;
  at?: Date;
};

export function recordHistory(tx: Tx, e: HistoryEntry): void {
  tx.insert(testimonialHistory)
    .values({
      id: crypto.randomUUID(),
      testimonialId: e.testimonialId,
      actor: e.actor,
      actorEmail: e.actorEmail ?? null,
      action: e.action,
      diff: JSON.stringify(e.diff),
      createdAt: e.at ?? new Date(),
    })
    .run();
}

/** Oldest first; rowid keeps entries from the same millisecond in the order they were written. */
export function listHistory(testimonialId: string): TestimonialHistory[] {
  return getDb()
    .select()
    .from(testimonialHistory)
    .where(eq(testimonialHistory.testimonialId, testimonialId))
    .orderBy(asc(testimonialHistory.createdAt), sql`rowid`)
    .all();
}

/** The stored diff as an object ({} if it can't be read). */
export function parseDiff(raw: string): Record<string, [unknown, unknown]> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** A history row as the dashboard and API get it, with the diff parsed. */
export function historyToJson(h: TestimonialHistory) {
  return { ...h, diff: parseDiff(h.diff) };
}

/** Who made a change, from how it was made: the dashboard, an API key or auto-approve. */
export function historyActor(approver: Approver | undefined): HistoryActor {
  return approver ?? "owner";
}

/** Who added a testimonial, from its source (form, api, manual, import:<x>, importer:<x>). */
export function actorForSource(source: string): HistoryActor {
  if (source === "form") return "customer";
  if (source === "api") return "api";
  if (source === "manual") return "owner";
  if (source.startsWith("import")) return "import";
  return "system";
}
