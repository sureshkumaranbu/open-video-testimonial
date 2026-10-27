import { z } from "zod";
import { jsonError, requireAdmin } from "@/lib/http";
import { deleteProjectFeedback, listProjectFeedback, PAGE_SIZES } from "@/lib/inbox";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** The Feedback tab: private answers, newest first (`?page=&size=`). */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const sp = new URL(req.url).searchParams;
  const size = Number(sp.get("size"));
  const pageSize = (PAGE_SIZES as readonly number[]).includes(size) ? size : 25;
  const page = Math.max(1, Math.floor(Number(sp.get("page")) || 1));
  return Response.json({ ...listProjectFeedback(project.id, { page, pageSize }), page, pageSize });
}

const deleteSchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(500) });

/** Deletes feedback for good: `{ids}`. Ids from another project are ignored. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  return Response.json({ deleted: deleteProjectFeedback(project.id, parsed.data.ids) });
}
