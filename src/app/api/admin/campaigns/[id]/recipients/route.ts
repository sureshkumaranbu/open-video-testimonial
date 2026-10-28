import { addRecipients, MAX_IMPORT_ROWS, recipientRows, recipientsBody, recipientToAdmin } from "@/lib/campaigns";
import { jsonError, requireRole } from "@/lib/http";
import { firstIssue } from "@/lib/validation";
import { campaignAndProject } from "../guard";

type Ctx = { params: Promise<{ id: string }> };

/**
 * REQ-02: adds people to the campaign. The report lists every row that was
 * skipped and why (bad address, already in the campaign, unsubscribed,
 * already responded). On an active campaign the invitations go out at once.
 */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const found = campaignAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Campaign not found");
  const parsed = recipientsBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const { project, campaign } = found;
  const d = parsed.data;
  const rows = recipientRows(project, d);
  if (rows.length === 0) return jsonError(400, d.source === "customers" ? "None of those customers has an email address" : "No people found in that text");
  if (rows.length > MAX_IMPORT_ROWS) return jsonError(400, `Add at most ${MAX_IMPORT_ROWS.toLocaleString("en")} people at a time`);
  const { created, skipped } = addRecipients(project, campaign, rows);
  return Response.json({ added: created.map((r) => recipientToAdmin(project, r)), skipped, rows: rows.length }, { status: 201 });
}
