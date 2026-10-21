import { CORS_HEADERS, jsonError } from "@/lib/http";
import { getProjectBySlug, listPublicTestimonials } from "@/lib/testimonials";

/**
 * Public, CORS-enabled feed of approved testimonials, consumed by the
 * embeddable widget script. Media URLs are relative to this server.
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const project = getProjectBySlug(slug);
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
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
