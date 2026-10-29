import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { INSIGHT_REPORT_KINDS, type InsightReport } from "@/db/schema";
import { toCsv } from "../csv";
import type { NpsSummary } from "./nps";
import type { AskResult, VocReport } from "./voc";

const { insightReports } = schema;

/**
 * VOC-01: saved reports. A report is kept as it was shown (what was asked
 * and what came back), so it reads the same later even after testimonials
 * change, and can be downloaded as CSV. Reports hold excerpts of
 * testimonials, never emails; they're for the team only.
 */

/** A report's stored size cap. */
const MAX_RESULT_BYTES = 512 * 1024;
export const MAX_REPORTS = 200;

export class ReportError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const saveReportSchema = z.object({
  kind: z.enum(INSIGHT_REPORT_KINDS),
  name: z.string().trim().min(1, "Name the report").max(120),
  params: z.record(z.string(), z.unknown()).default({}),
  result: z.record(z.string(), z.unknown()),
});

export function listReports(projectId: string): InsightReport[] {
  return getDb().select().from(insightReports).where(eq(insightReports.projectId, projectId)).orderBy(desc(insightReports.createdAt)).all();
}

export function getReport(id: string): InsightReport | null {
  return getDb().select().from(insightReports).where(eq(insightReports.id, id)).get() ?? null;
}

export function saveReport(projectId: string, input: unknown, by?: string | null): InsightReport {
  const parsed = saveReportSchema.safeParse(input);
  if (!parsed.success) throw new ReportError(400, parsed.error.issues[0]?.message ?? "Check the report and try again");
  const result = JSON.stringify(parsed.data.result);
  if (Buffer.byteLength(result) > MAX_RESULT_BYTES) throw new ReportError(413, "That report is too large to save; narrow the range or tags");
  if (listReports(projectId).length >= MAX_REPORTS) throw new ReportError(409, `A project keeps at most ${MAX_REPORTS} reports; delete some first`);
  return getDb()
    .insert(insightReports)
    .values({ id: crypto.randomUUID(), projectId, kind: parsed.data.kind, name: parsed.data.name, params: JSON.stringify(parsed.data.params), result, createdBy: by ?? null, createdAt: new Date() })
    .returning()
    .get();
}

export function deleteReport(id: string): boolean {
  return getDb().delete(insightReports).where(eq(insightReports.id, id)).run().changes > 0;
}

const json = (raw: string) => {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
};

export function reportToAdmin(r: InsightReport, o: { full?: boolean } = {}) {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    params: json(r.params),
    ...(o.full ? { result: json(r.result) } : {}),
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * A saved report as CSV: one row per finding, with the testimonials it
 * cites (name and excerpt), so it opens cleanly in a spreadsheet.
 */
export function reportCsv(r: InsightReport): string {
  const result = json(r.result);
  const rows: unknown[][] = [];
  if (r.kind === "voc") {
    const v = result as unknown as Partial<VocReport>;
    const who = (ids: string[]) => ids.map((id) => v.cited?.[id]).filter(Boolean).map((c) => `${c!.name}: ${c!.excerpt}`).join(" | ");
    const b = v.breakdown;
    if (b) {
      rows.push(["Breakdown", "Testimonials", b.count, "", ""]);
      if (b.average != null) rows.push(["Breakdown", "Average rating", b.average, "", ""]);
      for (const [k, n] of Object.entries(b.sentiment ?? {})) rows.push(["Sentiment", k, n, "", ""]);
      for (const x of b.ratings ?? []) rows.push(["Ratings", String(x.value), x.count, "", ""]);
    }
    for (const t of v.themes?.themes ?? []) rows.push(["Theme (AI)", t.name, t.ids.length, t.summary, who(t.ids)]);
    for (const t of v.themes?.love ?? []) rows.push(["What they love (AI)", t.point, t.ids.length, "", who(t.ids)]);
    for (const t of v.themes?.improve ?? []) rows.push(["What to improve (AI)", t.point, t.ids.length, "", who(t.ids)]);
    for (const [section, list] of [
      ["Phrase", v.keywords?.phrases],
      ["Word", v.keywords?.words],
      ["What they love (phrases)", v.keywords?.love],
      ["What to improve (phrases)", v.keywords?.improve],
    ] as const) {
      for (const k of list ?? []) rows.push([section, k.label, k.count, "", who(k.ids)]);
    }
    return toCsv(["Section", "Item", "Count", "Summary", "Testimonials"], rows);
  }
  if (r.kind === "ask") {
    const a = result as unknown as Partial<AskResult>;
    rows.push(["Question", a.question ?? "", "", "", ""]);
    rows.push(["Answer", a.answer ?? a.note ?? "", "", "", ""]);
    for (const m of a.matches ?? []) rows.push([a.cited?.includes(m.id) ? "Cited" : "Match", m.excerpt, m.name, m.rating ?? "", m.date]);
    return toCsv(["Row", "Text", "Name", "Rating", "Date"], rows);
  }
  const n = result as unknown as Partial<NpsSummary>;
  rows.push(["NPS", n.score ?? "", "", "", ""]);
  rows.push(["Responses", n.responses ?? 0, "", "", ""]);
  rows.push(["Promoters", n.promoters ?? 0, "", "", ""]);
  rows.push(["Passives", n.passives ?? 0, "", "", ""]);
  rows.push(["Detractors", n.detractors ?? 0, "", "", ""]);
  for (const p of n.trend?.points ?? []) rows.push([`Trend (${n.trend?.by ?? "day"})`, p.score, p.responses, p.period, ""]);
  for (const c of n.comments ?? []) rows.push(["Comment", c.score, c.name ?? "", c.date, c.comment]);
  return toCsv(["Row", "Value", "Count or name", "Period or date", "Comment"], rows);
}
