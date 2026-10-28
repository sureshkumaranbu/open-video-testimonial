import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { ANALYTICS_OBJECTS, type AnalyticsObject } from "@/db/schema";
import { analyticsUi, objectReport, parseRange } from "@/lib/analytics";
import { jsonError, requireRole } from "@/lib/http";

const TABLES = { widget: schema.widgets, form: schema.forms, wall: schema.walls, snippet: schema.seoSnippets, testimonial: schema.testimonials } as const;

/**
 * DISP-14, FORM-15, WALL-05, SEO-04, WALL-04: one widget, form, wall, snippet or testimonial page over
 * `?from=&to=` (default the last 30 days), with the previous period.
 */
export async function GET(req: Request, ctx: { params: Promise<{ type: string; id: string }> }) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  if (!analyticsUi()) return jsonError(404, "Analytics is switched off on this server");
  const { type, id } = await ctx.params;
  if (!(ANALYTICS_OBJECTS as readonly string[]).includes(type)) return jsonError(404, "Not found");
  const table = TABLES[type as AnalyticsObject];
  const row = getDb().select({ projectId: table.projectId }).from(table).where(eq(table.id, id)).get();
  if (!row) return jsonError(404, "Not found");
  const q = new URL(req.url).searchParams;
  return Response.json({ report: objectReport(type as AnalyticsObject, id, row.projectId, parseRange(q.get("from"), q.get("to"))) });
}
