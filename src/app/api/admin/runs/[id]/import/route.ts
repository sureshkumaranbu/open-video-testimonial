import { z } from "zod";
import { jsonError, requireRole } from "@/lib/http";
import { ImportError, startImport } from "@/lib/importers/run";
import { firstIssue } from "@/lib/validation";

const body = z.object({
  selection: z.union([z.literal("all"), z.array(z.string().min(1).max(200)).min(1, "Choose at least one testimonial to import").max(1000)]),
});

/** Starts a previewed import: the chosen items, or "all" matching ones. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    return Response.json({ run: startImport((await ctx.params).id, parsed.data.selection) });
  } catch (err) {
    if (err instanceof ImportError) return Response.json({ error: err.message, code: err.code ?? null }, { status: err.status });
    throw err;
  }
}
