import { z } from "zod";
import type { Project } from "@/db/schema";
import { getRequestSession } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/http";
import { getInboxPrefs, MAX_BULK, parseInboxParams, type InboxQuery } from "@/lib/inbox";
import { inboxExport } from "@/lib/inbox-export";
import { exportZip, testimonialsCsv } from "@/lib/portability";
import { getProjectById, listTestimonials } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const TYPES = { csv: "text/csv; charset=utf-8", json: "application/json; charset=utf-8" } as const;

/** The inbox view as a download (INBOX-15). */
function viewDownload(project: Project, q: InboxQuery & { ids?: string[] }, format: "csv" | "json") {
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(inboxExport(project.id, q, format), {
    headers: {
      ...HEADERS,
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="plaudit-${project.slug}-testimonials-${stamp}.${format}"`,
    },
  });
}

/**
 * Downloads the whole project as a .zip (default) or a CSV of every
 * testimonial (?format=csv). With any inbox view parameter (`tab`, `q`,
 * `rating`…) or `ids=a,b`, CSV and JSON export just that view or those rows.
 */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") ?? "zip";
  const stamp = new Date().toISOString().slice(0, 10);
  const view = [...sp.keys()].some((k) => k !== "format");
  if (format === "json" || (format === "csv" && view)) {
    const prefs = getInboxPrefs(getRequestSession(req)?.email);
    const q = parseInboxParams(sp, { sort: prefs.inboxSort, dir: prefs.inboxDir });
    const ids = sp.has("ids") ? (sp.get("ids") ?? "").split(",").filter(Boolean).slice(0, MAX_BULK) : undefined;
    return viewDownload(project, { ...q, ids }, format);
  }
  if (format === "csv") {
    // Unchanged since before the inbox: every testimonial, in every status.
    return new Response(testimonialsCsv(listTestimonials(project.id)), {
      headers: {
        ...HEADERS,
        "Content-Type": TYPES.csv,
        "Content-Disposition": `attachment; filename="plaudit-${project.slug}-${stamp}.csv"`,
      },
    });
  }
  return new Response(exportZip(project), {
    headers: {
      ...HEADERS,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="plaudit-${project.slug}-${stamp}.zip"`,
    },
  });
}

const selectionSchema = z.object({
  format: z.enum(["csv", "json"]),
  ids: z.array(z.string().min(1).max(64)).min(1, "Select at least one testimonial").max(MAX_BULK),
});

/** Exports the selected rows: `{format, ids}` (a long selection doesn't fit in a URL). */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const parsed = selectionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  return viewDownload(project, { ...parseInboxParams(new URLSearchParams()), ids: parsed.data.ids }, parsed.data.format);
}
