import { apiJson } from "@/lib/api-keys";
import { apiError, libError, MAX_CONFIG_BYTES, projectOfRow, readJson, requireApi2, widgetToApi } from "@/lib/api-v1";
import { firstIssue } from "@/lib/validation";
import { deleteWidget, getLiveWidget, updateWidget, widgetPatchBody, type WidgetConfigInput } from "@/lib/widgets";

type Ctx = { params: Promise<{ id: string }> };

/** The live widget, if the key may reach its project. */
function load(key: Parameters<typeof projectOfRow>[0], id: string) {
  const w = getLiveWidget(id);
  return w && projectOfRow(key, w) ? w : null;
}

/** GET /api/v1/widgets/:id (API-01) */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "read");
  if (auth.error) return auth.error;
  const w = load(auth.key, (await ctx.params).id);
  if (!w) return apiError(404, "Widget not found");
  return apiJson({ data: widgetToApi(w) });
}

/** PATCH /api/v1/widgets/:id (write scope): name, placement, connected form, and the whole config, as the studio saves it. */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "write");
  if (auth.error) return auth.error;
  const w = load(auth.key, (await ctx.params).id);
  if (!w) return apiError(404, "Widget not found");
  const body = await readJson(req, MAX_CONFIG_BYTES);
  if (body.error) return body.error;
  const parsed = widgetPatchBody.safeParse(body.value);
  if (!parsed.success) return apiError(400, firstIssue(parsed.error));
  const { config, ...rest } = parsed.data;
  try {
    const next = updateWidget(w.id, { ...rest, config: config as WidgetConfigInput | undefined });
    if (!next) return apiError(404, "Widget not found");
    return apiJson({ data: widgetToApi(next) });
  } catch (err) {
    return libError(err);
  }
}

/** DELETE /api/v1/widgets/:id (write scope): pages that still embed it show nothing. */
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "write");
  if (auth.error) return auth.error;
  const w = load(auth.key, (await ctx.params).id);
  if (!w || !deleteWidget(w.id)) return apiError(404, "Widget not found");
  return apiJson({ ok: true });
}
