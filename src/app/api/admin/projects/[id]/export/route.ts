import { jsonError, requireAdmin } from "@/lib/http";
import { exportZip, testimonialsCsv } from "@/lib/portability";
import { getProjectById, listTestimonials } from "@/lib/testimonials";

/** Downloads the whole project as a .zip (default) or just a CSV (?format=csv). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const stamp = new Date().toISOString().slice(0, 10);
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (new URL(req.url).searchParams.get("format") === "csv") {
    return new Response(testimonialsCsv(listTestimonials(project.id)), {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="plaudit-${project.slug}-${stamp}.csv"`,
      },
    });
  }
  return new Response(exportZip(project), {
    headers: {
      ...headers,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="plaudit-${project.slug}-${stamp}.zip"`,
    },
  });
}
