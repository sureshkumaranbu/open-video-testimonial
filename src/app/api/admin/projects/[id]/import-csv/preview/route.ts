import { z } from "zod";
import { IMPORT_FIELDS, previewCsv } from "@/lib/csv-import";
import { jsonError, readJsonCapped, requireRole } from "@/lib/http";
import { firstIssue } from "@/lib/validation";

const MAX_BODY = 30 * 1024 * 1024;

const body = z.object({
  csv: z.string().min(1, "The file is empty").max(20 * 1024 * 1024),
  mapping: z.partialRecord(z.enum(IMPORT_FIELDS), z.string().max(200)).optional(),
});

/** Detected column mapping plus the first rows, before importing anything. */
export async function POST(req: Request) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const raw = await readJsonCapped(req, MAX_BODY);
  if (raw instanceof Response) return raw;
  const parsed = body.safeParse(raw);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  return Response.json(previewCsv(parsed.data.csv, parsed.data.mapping));
}
