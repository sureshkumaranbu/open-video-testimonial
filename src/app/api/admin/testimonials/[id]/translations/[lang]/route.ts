import { getRequestSession } from "@/lib/auth";
import { jsonError, readJsonCapped, requireAdmin } from "@/lib/http";
import { deleteTranslation, langSchema, saveTranslation, translationBody, TranslationError } from "@/lib/translations";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string; lang: string }> };

/** Adds or edits the translation into one language, by hand. */
export async function PUT(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id, lang } = await ctx.params;
  const code = langSchema.safeParse(lang);
  if (!code.success) return jsonError(400, firstIssue(code.error));
  const raw = await readJsonCapped(req, 64 * 1024);
  if (raw instanceof Response) return raw;
  const parsed = translationBody.safeParse(raw);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    return Response.json({ translation: saveTranslation(id, code.data, parsed.data, { by: getRequestSession(req)?.email }) });
  } catch (err) {
    if (err instanceof TranslationError) return jsonError(err.status, err.message);
    throw err;
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id, lang } = await ctx.params;
  const code = langSchema.safeParse(lang);
  if (!code.success) return jsonError(400, firstIssue(code.error));
  if (!deleteTranslation(id, code.data, { by: getRequestSession(req)?.email })) return jsonError(404, "No translation into that language");
  return new Response(null, { status: 204 });
}
