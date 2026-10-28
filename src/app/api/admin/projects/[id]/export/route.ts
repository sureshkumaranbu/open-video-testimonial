import { auditRequest } from "@/lib/audit";
import { z } from "zod";
import type { Project } from "@/db/schema";
import { getRequestSession } from "@/lib/auth";
import { jsonError, requireRole } from "@/lib/http";
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
 * `rating`…) or `ids=a,b`, CSV and JSON export just that view or those rows;
 * without a `tab`, the view is All (everything but the trash).
 */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") ?? "zip";
  const stamp = new Date().toISOString().slice(0, 10);
  auditRequest(req, `export.${format === "json" || format === "csv" ? format : "zip"}`, { objectType: "project", objectId: project.id, projectId: project.id, summary: project.name, meta: { view: [...sp.keys()].filter((k) => k !== "format") } });
  const view = [...sp.keys()].some((k) => k !== "format");
  if (format === "json" || (format === "csv" && view)) {
    const prefs = getInboxPrefs(getRequestSession(req)?.email);
    const q = parseInboxParams(sp, { sort: prefs.inboxSort, dir: prefs.inboxDir });
    // A bare ?format=json is the whole inbox (All), not the Pending tab the dashboard opens on.
    if (!sp.has("tab")) q.tab = "all";
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
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const parsed = selectionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  auditRequest(req, `export.${parsed.data.format}`, { objectType: "project", objectId: project.id, projectId: project.id, summary: `${parsed.data.ids.length} selected`, meta: { ids: parsed.data.ids.slice(0, 100) } });
  return viewDownload(project, { ...parseInboxParams(new URLSearchParams()), ids: parsed.data.ids }, parsed.data.format);
}
