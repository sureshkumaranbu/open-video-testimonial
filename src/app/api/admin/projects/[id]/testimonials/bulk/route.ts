import { auditRequest } from "@/lib/audit";
import { z } from "zod";
import { getRequestSession } from "@/lib/auth";
import { jsonError, requireRole } from "@/lib/http";
import { BULK_ACTIONS, BulkError, bulkUpdate, MAX_BULK } from "@/lib/inbox";
import { getProjectById } from "@/lib/testimonials";
import { langSchema } from "@/lib/translations";
import { firstIssue, tagNameSchema } from "@/lib/validation";
// Registers the notifications listener in this route's bundle (approvals post to chat channels).
import "@/lib/notifications";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  action: z.enum(BULK_ACTIONS),
  ids: z.array(z.string().min(1).max(64)).min(1, "Select at least one testimonial").max(MAX_BULK, `Select at most ${MAX_BULK} testimonials at a time`),
  tags: z.array(tagNameSchema).max(20).optional(),
  /** For "translate" (INBOX-13): the languages, up to 10. */
  langs: z.array(langSchema).max(10).optional(),
});

/**
 * One action on up to 500 testimonials of this project (INBOX-06). Answers
 * `{updated, skipped: [{id, reason}]}`: ids from another project, and rows
 * that can't take the action (a withdrawn one can't be approved), are skipped.
 */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    const result = await bulkUpdate(project.id, parsed.data.ids, parsed.data.action, {
      by: getRequestSession(req)?.email,
      tags: parsed.data.tags,
      langs: parsed.data.langs,
    });
    auditRequest(req, `testimonial.bulk.${parsed.data.action}`, { objectType: "project", objectId: project.id, projectId: project.id, summary: `${result.updated.length} testimonials`, meta: { ids: result.updated.slice(0, 100), tags: parsed.data.tags } });
    return Response.json(result);
  } catch (err) {
    if (err instanceof BulkError) return jsonError(400, err.message);
    throw err;
  }
}
