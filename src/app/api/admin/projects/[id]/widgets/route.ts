import { jsonError, requireRole } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";
import { createWidget, createWidgetBody, listWidgets, WidgetError, widgetToAdmin, type WidgetConfigInput } from "@/lib/widgets";

type Ctx = { params: Promise<{ id: string }> };

/** DISP-12: the project's saved widgets, oldest first. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  return Response.json({ widgets: listWidgets(project.id).map(widgetToAdmin) });
}

/** A new widget with the default look for its layout. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const parsed = createWidgetBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const { name, layout, placement, connectedFormId, config } = parsed.data;
  try {
    const w = createWidget(project.id, {
      name,
      layout,
      placement: placement || null,
      connectedFormId: connectedFormId ?? null,
      config: config as Partial<WidgetConfigInput> | undefined,
    });
    return Response.json({ widget: widgetToAdmin(w) }, { status: 201 });
  } catch (err) {
    if (err instanceof WidgetError) return jsonError(err.status, err.message);
    throw err;
  }
}
