import { getRequestSession } from "../auth";
import { roleAtLeast } from "../access";
import { jsonError } from "../http";
import { firstIssue } from "../validation";
import { CaseStudyError } from "../case-studies";
import { npsFiltersSchema, type NpsFilters } from "./nps";
import { ReportError } from "./reports";
import { InsightsError, insightFiltersSchema, type InsightFilters } from "./voc";

/** Filters from a query string: ?from=&to=&tags=a,b&source=&formId=. A Response when they don't parse. */
export function filtersFromQuery(url: string): InsightFilters | Response {
  const sp = new URL(url).searchParams;
  const parsed = insightFiltersSchema.safeParse({
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    tags: (sp.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    source: sp.get("source") || undefined,
    formId: sp.get("formId") || undefined,
  });
  return parsed.success ? parsed.data : jsonError(400, firstIssue(parsed.error));
}

export function filtersFromBody(body: unknown): InsightFilters | Response {
  const parsed = insightFiltersSchema.safeParse(body && typeof body === "object" ? body : {});
  return parsed.success ? parsed.data : jsonError(400, firstIssue(parsed.error));
}

export function npsFiltersFromQuery(url: string): NpsFilters | Response {
  const sp = new URL(url).searchParams;
  const parsed = npsFiltersSchema.safeParse({ from: sp.get("from") || undefined, to: sp.get("to") || undefined, formId: sp.get("formId") || undefined });
  return parsed.success ? parsed.data : jsonError(400, firstIssue(parsed.error));
}

/** Whether the signed-in person may send things to the AI provider (editors and up; viewers read). */
export function mayUseAi(req: Request) {
  const s = getRequestSession(req);
  return Boolean(s && roleAtLeast(s.role, "editor"));
}

export function insightsErrorResponse(err: unknown): Response {
  if (err instanceof InsightsError || err instanceof ReportError || err instanceof CaseStudyError) return jsonError(err.status, err.message);
  throw err;
}
