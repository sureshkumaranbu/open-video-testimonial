import { z } from "zod";
import { FORM_VIDEO_SLOTS } from "@/db/schema";
import { auditRequest } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/http";
import { firstIssue } from "@/lib/validation";
import { formVideosToAdmin, removeFormVideo, setFormVideo } from "@/lib/video/form-videos";
import { renderErrorResponse } from "@/lib/video/http";
import { loadForm } from "../shared";

type Ctx = { params: Promise<{ id: string }> };

/** FORM-17: the owner's welcome and thank-you videos on this form, with their state. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const found = loadForm((await ctx.params).id);
  if (found instanceof Response) return found;
  return Response.json({ videos: formVideosToAdmin(found.form.id) }, { headers: { "Cache-Control": "private, no-store" } });
}

const body = z.object({
  slot: z.enum(FORM_VIDEO_SLOTS),
  upload: z.object({ id: z.string().min(1).max(64), token: z.string().min(1).max(200) }),
});

/**
 * FORM-17: `{slot, upload}` puts a finished upload (POST /api/admin/uploads
 * with kind=video and this form's project) on the welcome or thank-you
 * page, replacing what was there. It's converted, then transcribed for captions.
 */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const found = loadForm((await ctx.params).id);
  if (found instanceof Response) return found;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    await setFormVideo(found.form.id, parsed.data.slot, parsed.data.upload);
  } catch (err) {
    return renderErrorResponse(err);
  }
  auditRequest(req, "form.video", { objectType: "form", objectId: found.form.id, projectId: found.form.projectId, summary: `Added a ${parsed.data.slot === "welcome" ? "welcome" : "thank-you"} video` });
  return Response.json({ videos: formVideosToAdmin(found.form.id) }, { status: 201 });
}

/** FORM-17: `?slot=welcome|thank_you` takes that video off the form and deletes its files. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const found = loadForm((await ctx.params).id);
  if (found instanceof Response) return found;
  const slot = z.enum(FORM_VIDEO_SLOTS).safeParse(new URL(req.url).searchParams.get("slot"));
  if (!slot.success) return jsonError(400, "Choose slot=welcome or slot=thank_you");
  if (!(await removeFormVideo(found.form.id, slot.data))) return jsonError(404, "There's no video there");
  auditRequest(req, "form.video_remove", { objectType: "form", objectId: found.form.id, projectId: found.form.projectId, summary: "Removed a form video" });
  return Response.json({ videos: formVideosToAdmin(found.form.id) });
}
