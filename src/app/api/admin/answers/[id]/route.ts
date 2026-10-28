import { z } from "zod";
import { getRequestSession } from "@/lib/auth";
import { updateAnswer } from "@/lib/answers";
import { jsonError, requireRole } from "@/lib/http";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({ text: z.string().trim().max(5000).nullable() });

/**
 * Corrects the text of one answer (INBOX-08: every answer, not only the
 * main one). Marks the testimonial edited after consent and records it in
 * the history and the consent ledger.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const answer = updateAnswer((await ctx.params).id, { text: parsed.data.text || null }, { by: getRequestSession(req)?.email });
  if (!answer) return jsonError(404, "Answer not found");
  return Response.json({ answer });
}
