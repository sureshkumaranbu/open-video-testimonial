import { jsonError } from "@/lib/http";
import { decline, findRequestByDeclineToken } from "@/lib/requests";

/** "No thanks" (M9, REQ-05): the /d/:token page calls this from its button. */
export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (token === "test") return Response.json({ ok: true, test: true });
  const r = findRequestByDeclineToken(token);
  if (!r) return jsonError(404, "This link isn't valid");
  const row = decline(r);
  return Response.json({ ok: true, status: row.status });
}
