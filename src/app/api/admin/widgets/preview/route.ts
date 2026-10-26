import { jsonError, requireAdmin } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";
import { previewBody, widgetConfigSchema, widgetPayload } from "@/lib/widgets";

/**
 * The studio's live preview: the public payload for an unsaved config, built
 * by the same code as GET /api/widget/w_…, so what the preview draws is what
 * the embed will draw. Never cached.
 */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const parsed = previewBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const project = getProjectById(parsed.data.projectId);
  if (!project) return jsonError(404, "Project not found");
  const cfg = widgetConfigSchema.safeParse(parsed.data.config);
  if (!cfg.success) return jsonError(400, firstIssue(cfg.error));
  const formId = parsed.data.connectedFormId ?? null;
  const payload = widgetPayload(project, { id: "w_preview00000", connectedFormId: formId }, cfg.data);
  return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
}
