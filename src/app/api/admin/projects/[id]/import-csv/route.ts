import { z } from "zod";
import { IMPORT_FIELDS, importCsv } from "@/lib/csv-import";
import { jsonError, readJsonCapped, requireAdmin } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

const MAX_BODY = 30 * 1024 * 1024;

const csvBody = z.object({
  csv: z.string().min(1, "The file is empty").max(20 * 1024 * 1024, "The file is larger than 20 MB"),
  mapping: z.partialRecord(z.enum(IMPORT_FIELDS), z.string().max(200)).optional(),
  approve: z.boolean().default(false),
  fetchMedia: z.boolean().default(false),
});

/** Imports testimonials from a CSV into this project. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  // A 20 MB file as JSON, with room for escaping; reading stops past it.
  const raw = await readJsonCapped(req, MAX_BODY);
  if (raw instanceof Response) return raw;
  const parsed = csvBody.safeParse(raw);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const { csv, mapping, ...opts } = parsed.data;
  try {
    return Response.json(importCsv(project, csv, { mapping: mapping && Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)), ...opts }));
  } catch (err) {
    return jsonError(400, (err as Error).message);
  }
}
