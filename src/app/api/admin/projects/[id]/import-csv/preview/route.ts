import { z } from "zod";
import { IMPORT_FIELDS, previewCsv } from "@/lib/csv-import";
import { jsonError, requireAdmin } from "@/lib/http";
import { firstIssue } from "@/lib/validation";

const body = z.object({
  csv: z.string().min(1, "The file is empty").max(20 * 1024 * 1024),
  mapping: z.partialRecord(z.enum(IMPORT_FIELDS), z.string().max(200)).optional(),
});

/** Detected column mapping plus the first rows, before importing anything. */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  return Response.json(previewCsv(parsed.data.csv, parsed.data.mapping));
}
