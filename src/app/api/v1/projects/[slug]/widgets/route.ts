import { apiJson } from "@/lib/api-keys";
import { apiError, libError, MAX_CONFIG_BYTES, projectForKey, readJson, requireApi2, widgetToApi } from "@/lib/api-v1";
import { firstIssue } from "@/lib/validation";
import { createWidget, createWidgetBody, listWidgets, type WidgetConfigInput } from "@/lib/widgets";

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/v1/projects/:slug/widgets (API-01): saved widgets, oldest first, each with its embed snippets. */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "read");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  return apiJson({ data: listWidgets(project.id).map(widgetToApi) });
}

/** POST /api/v1/projects/:slug/widgets (write scope): a new widget with the default look for its layout, or the config sent. */
export async function POST(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "write");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  const body = await readJson(req, MAX_CONFIG_BYTES);
  if (body.error) return body.error;
  const parsed = createWidgetBody.safeParse(body.value);
  if (!parsed.success) return apiError(400, firstIssue(parsed.error));
  const { name, layout, placement, connectedFormId, config } = parsed.data;
  try {
    const w = createWidget(project.id, {
      name,
      layout,
      placement: placement || null,
      connectedFormId: connectedFormId ?? null,
      config: config as Partial<WidgetConfigInput> | undefined,
    });
    return apiJson({ data: widgetToApi(w) }, 201);
  } catch (err) {
    return libError(err);
  }
}
