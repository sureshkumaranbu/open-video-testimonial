import { boosterPatchBody, boosterToAdmin, deleteBooster, updateBooster } from "@/lib/boosters";
import { jsonError, requireRole } from "@/lib/http";
import { firstIssue } from "@/lib/validation";
import { boosterAndProject, boosterError } from "./guard";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const found = boosterAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Booster not found");
  return Response.json({ booster: boosterToAdmin(found.booster, found.project) });
}

/** Name, draft or public, title, message, links (http(s) only, or one of the project's forms) and design. */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const parsed = boosterPatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const found = boosterAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Booster not found");
  try {
    const b = updateBooster(found.booster.id, parsed.data);
    if (!b) return jsonError(404, "Booster not found");
    return Response.json({ booster: boosterToAdmin(b, found.project) });
  } catch (err) {
    return boosterError(err);
  }
}

/** Deletes the page; its link, QR codes and old links stop working. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  if (!(await deleteBooster((await ctx.params).id))) return jsonError(404, "Booster not found");
  return Response.json({ ok: true });
}
