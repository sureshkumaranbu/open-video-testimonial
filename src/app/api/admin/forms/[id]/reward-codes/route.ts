import { z } from "zod";
import { jsonError, requireRole } from "@/lib/http";
import { addCodes, listClaims, poolStats, removeUnclaimed, RewardError } from "@/lib/rewards";
import { firstIssue } from "@/lib/validation";
import { loadForm } from "../shared";

type Ctx = { params: Promise<{ id: string }> };

/** A pasted list or the text of a CSV file (first column), 2 MB at most. */
const addBody = z.object({ text: z.string().max(2_000_000, "That file is too big: split it into smaller ones") });

/** FORM-13 claim tracking: how many codes are left, and the latest claims with who got each one. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const found = loadForm((await ctx.params).id);
  if (found instanceof Response) return found;
  return Response.json({ stats: poolStats(found.form.id), claims: listClaims(found.form.id) });
}

/** Adds codes to the form's pool; codes already in it are skipped and counted. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const found = loadForm((await ctx.params).id);
  if (found instanceof Response) return found;
  const parsed = addBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    const result = addCodes(found.form, parsed.data.text);
    if (!result.added && !result.duplicates) return jsonError(400, result.invalid ? "None of those lines is a code" : "Paste or upload at least one code");
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof RewardError) return jsonError(err.status, err.message);
    throw err;
  }
}

/** Removes the codes nobody has claimed yet. Claimed ones stay, for the record. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const found = loadForm((await ctx.params).id);
  if (found instanceof Response) return found;
  return Response.json(removeUnclaimed(found.form.id));
}
