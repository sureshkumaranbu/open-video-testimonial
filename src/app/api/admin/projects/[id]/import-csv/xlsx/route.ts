import { jsonError, readCappedBytes, requireAdmin } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { looksLikeXlsx, readXlsx, rowsToCsv, XLSX_MAX_FILE_BYTES, XlsxError } from "@/lib/xlsx";

type Ctx = { params: Promise<{ id: string }> };

/**
 * IMP-04: the first sheet of an .xlsx file (sent as the raw request body) as
 * CSV text, so it goes through the same column mapper, preview and warnings
 * as a CSV. Nothing is imported here.
 */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const bytes = await readCappedBytes(req, XLSX_MAX_FILE_BYTES);
  if (bytes === null) return jsonError(413, "That file is larger than 20 MB");
  if (!bytes.length) return jsonError(400, "That file is empty");
  if (!looksLikeXlsx(bytes)) return jsonError(400, "That isn't an .xlsx file. Save the spreadsheet as Excel (.xlsx) or CSV and try again.");
  try {
    const sheet = readXlsx(bytes);
    if (sheet.rows.length < 2) return jsonError(400, "The first sheet needs a header row and at least one row of testimonials");
    return Response.json({ csv: rowsToCsv(sheet.rows), rows: sheet.rows.length - 1, truncated: sheet.truncated });
  } catch (err) {
    if (err instanceof XlsxError) return jsonError(400, err.message);
    throw err;
  }
}
