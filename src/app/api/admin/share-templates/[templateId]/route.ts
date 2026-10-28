import { z } from "zod";
import { jsonError, requireRole } from "@/lib/http";
import { shareFail } from "@/lib/share/http";
import { deleteShareTemplate, templateToAdmin, updateShareTemplate } from "@/lib/share/store";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ templateId: string }> };

const body = z.object({ name: z.string().trim().min(1).max(80), design: z.record(z.string(), z.unknown()) }).partial();

/** SHARE-02: rename a saved template or replace its design. */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    const t = updateShareTemplate((await ctx.params).templateId, parsed.data);
    if (!t) return jsonError(404, "Not found");
    return Response.json({ template: templateToAdmin(t) });
  } catch (err) {
    return shareFail(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  if (!deleteShareTemplate((await ctx.params).templateId)) return jsonError(404, "Not found");
  return Response.json({ ok: true });
}
