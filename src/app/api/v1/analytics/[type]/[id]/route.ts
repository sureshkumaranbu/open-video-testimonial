import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { ANALYTICS_OBJECTS, type AnalyticsObject } from "@/db/schema";
import { analyticsUi, objectReport, parseRange } from "@/lib/analytics";
import { apiJson } from "@/lib/api-keys";
import { apiError, projectOfRow, rangeParams, requireApi2 } from "@/lib/api-v1";

const TABLES = { widget: schema.widgets, form: schema.forms, wall: schema.walls, snippet: schema.seoSnippets, testimonial: schema.testimonials } as const;

/**
 * GET /api/v1/analytics/:type/:id?from=&to= (API-02, read): one widget,
 * form, wall, snippet or testimonial page over the period, with the previous
 * period, a daily series, top pages (widgets), per-page drop-off (forms) and
 * referring sites (snippets), exactly as its dashboard panel shows them.
 */
export async function GET(req: Request, ctx: { params: Promise<{ type: string; id: string }> }) {
  const auth = requireApi2(req, "read");
  if (auth.error) return auth.error;
  if (!analyticsUi()) return apiError(404, "Analytics is switched off on this server");
  const { type, id } = await ctx.params;
  if (!(ANALYTICS_OBJECTS as readonly string[]).includes(type)) return apiError(404, `Unknown type: use ${ANALYTICS_OBJECTS.join(", ")}`);
  const table = TABLES[type as AnalyticsObject];
  const row = getDb().select({ projectId: table.projectId }).from(table).where(eq(table.id, id)).get();
  const project = projectOfRow(auth.key, row);
  if (!row || !project) return apiError(404, "Not found");
  const range = rangeParams(new URL(req.url).searchParams);
  if (range instanceof Response) return range;
  return apiJson({ data: objectReport(type as AnalyticsObject, id, project.id, parseRange(range.from, range.to)) });
}
