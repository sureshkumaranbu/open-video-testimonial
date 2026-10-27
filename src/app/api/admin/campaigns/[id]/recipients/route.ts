import { z } from "zod";
import { addRecipients, importRows, MAX_IMPORT_ROWS, recipientToAdmin } from "@/lib/campaigns";
import { jsonError, requireAdmin } from "@/lib/http";
import { firstIssue } from "@/lib/validation";
import { campaignAndProject } from "../guard";

type Ctx = { params: Promise<{ id: string }> };

const person = z.object({
  email: z.string().trim().max(254),
  name: z.string().trim().max(120).optional(),
  company: z.string().trim().max(120).optional(),
  title: z.string().trim().max(120).optional(),
});

const body = z.discriminatedUnion("source", [
  /** Pasted lines, or a CSV file's text. */
  z.object({ source: z.literal("paste"), text: z.string().min(1, "Paste some people or load a CSV file").max(2_000_000) }),
  z.object({ source: z.literal("customers"), ids: z.array(z.string().max(64)).min(1, "Pick at least one customer").max(MAX_IMPORT_ROWS) }),
  z.object({ source: z.literal("manual"), person }),
]);

/**
 * REQ-02: adds people to the campaign. The report lists every row that was
 * skipped and why (bad address, already in the campaign, unsubscribed,
 * already responded). On an active campaign the invitations go out at once.
 */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const found = campaignAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Campaign not found");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const { project, campaign } = found;
  const d = parsed.data;
  const rows = importRows(
    project,
    d.source === "paste" ? { kind: "paste", text: d.text } : d.source === "customers" ? { kind: "customers", ids: d.ids } : { kind: "manual", person: d.person },
  );
  if (rows.length === 0) return jsonError(400, d.source === "customers" ? "None of those customers has an email address" : "No people found in that text");
  if (rows.length > MAX_IMPORT_ROWS) return jsonError(400, `Add at most ${MAX_IMPORT_ROWS.toLocaleString("en")} people at a time`);
  const { created, skipped } = addRecipients(project, campaign, rows);
  return Response.json({ added: created.map((r) => recipientToAdmin(project, r)), skipped, rows: rows.length }, { status: 201 });
}
