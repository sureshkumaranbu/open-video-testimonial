import { CORS_HEADERS, jsonError } from "@/lib/http";
import { findProjectBySlugOrAlias } from "@/lib/projects";
import { getProjectById, listPublicTestimonials } from "@/lib/testimonials";
import { visitorLang } from "@/lib/translations";
import { EMPTY_WIDGET_PAYLOAD, getWidget, WIDGET_ID, widgetConfig, widgetPayload } from "@/lib/widgets";

const CACHE = "public, max-age=60, stale-while-revalidate=300";
/** INT-07: a sales popup's purchases go stale fast, so it's cached briefly. */
const SALES_CACHE = "public, max-age=30, stale-while-revalidate=30";

/**
 * Widget mode (DISP-01): a saved widget's payload. A deleted one answers with
 * nothing to show. `?l=` is the visitor's browser language: a widget set to
 * show translations (INBOX-13) answers with the stored one for it, if any.
 * A sales popup (INT-07) answers with its purchases' display fields only
 * (src/lib/commerce/sales-feed.ts) and is cached for less time; like every
 * widget it sets no cookies.
 */
function savedWidget(id: string, lang: string | null) {
  const w = getWidget(id);
  const project = w && getProjectById(w.projectId);
  if (!w || !project) return jsonError(404, "Widget not found", CORS_HEADERS);
  const body = w.deletedAt ? EMPTY_WIDGET_PAYLOAD : widgetPayload(project, w, widgetConfig(w), { lang });
  return Response.json(body, { headers: { ...CORS_HEADERS, "Cache-Control": w.layout === "sales" ? SALES_CACHE : CACHE } });
}

/**
 * Public, CORS-enabled feed of approved testimonials, consumed by the
 * embeddable widget script. Media URLs are relative to this server. A
 * `w_…` id answers in widget mode; a project slug gets today's payload,
 * unchanged (D18).
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (WIDGET_ID.test(slug)) return savedWidget(slug, visitorLang(new URL(req.url).searchParams.get("l")));
  // An old slug is answered directly, not redirected, so embeds stay a simple CORS GET (D17).
  const project = findProjectBySlugOrAlias(slug)?.project;
  if (!project) return jsonError(404, "Project not found", CORS_HEADERS);

  const url = new URL(req.url);
  const tag = url.searchParams.get("tag")?.trim().toLowerCase() || undefined;
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 50;

  return Response.json(
    {
      project: { name: project.name, slug: project.slug, accentColor: project.accentColor },
      testimonials: listPublicTestimonials(project.id, { tag, limit }),
    },
    {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": CACHE,
      },
    },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
