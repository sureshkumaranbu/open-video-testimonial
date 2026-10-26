import { changeFormSlug } from "@/lib/forms";
import { slugBody } from "@/lib/forms/admin";
import { jsonError, requireAdmin } from "@/lib/http";
import { firstIssue } from "@/lib/validation";
import { formErrorResponse, formResponse } from "../shared";

/** Changes the form's link; the old one keeps working (a 308 to the new one). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const parsed = slugBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    changeFormSlug(id, parsed.data.slug);
  } catch (err) {
    return formErrorResponse(err);
  }
  return formResponse(id);
}
