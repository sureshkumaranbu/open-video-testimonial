import { jsonError, requireRole } from "@/lib/http";
import { firstIssue } from "@/lib/validation";
import { deleteWidget, getLiveWidget, updateWidget, WidgetError, widgetPatchBody, widgetToAdmin, type WidgetConfigInput } from "@/lib/widgets";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const w = getLiveWidget((await ctx.params).id);
  if (!w) return jsonError(404, "Widget not found");
  return Response.json({ widget: widgetToAdmin(w) });
}

/** Name, placement, connected form, and the whole config (the studio sends all of it on save). */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const parsed = widgetPatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const { config, ...rest } = parsed.data;
  try {
    const w = updateWidget((await ctx.params).id, { ...rest, config: config as WidgetConfigInput | undefined });
    if (!w) return jsonError(404, "Widget not found");
    return Response.json({ widget: widgetToAdmin(w) });
  } catch (err) {
    if (err instanceof WidgetError) return jsonError(err.status, err.message);
    throw err;
  }
}

/** Soft delete: pages that still embed it show nothing. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  if (!deleteWidget((await ctx.params).id)) return jsonError(404, "Widget not found");
  return Response.json({ ok: true });
}
