import { z } from "zod";
import { getRequestSession } from "@/lib/auth";
import { jsonError, readJsonCapped, requireRole } from "@/lib/http";
import { getTestimonial } from "@/lib/testimonials";
import { ProviderError, translationProviderName } from "@/lib/translate";
import { langSchema, listTranslations, machineTranslate, TranslationError } from "@/lib/translations";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** INBOX-13: the testimonial's translations, and which provider (if any) can make more. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const id = (await ctx.params).id;
  if (!getTestimonial(id)) return jsonError(404, "Testimonial not found");
  return Response.json({ translations: listTranslations(id), provider: translationProviderName() });
}

const body = z.object({ lang: langSchema });

/** Translates it into `lang` now with the owner's provider (a hand-written translation into that language is replaced). */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const id = (await ctx.params).id;
  const raw = await readJsonCapped(req, 1024);
  if (raw instanceof Response) return raw;
  const parsed = body.safeParse(raw);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    const translation = await machineTranslate(id, parsed.data.lang, { by: getRequestSession(req)?.email });
    return Response.json({ translation }, { status: 201 });
  } catch (err) {
    if (err instanceof TranslationError) return jsonError(err.status, err.message);
    if (err instanceof ProviderError) return jsonError(502, `The translation provider failed (${err.message}). Try again, or write it yourself.`);
    throw err;
  }
}
