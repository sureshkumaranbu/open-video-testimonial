import { z } from "zod";
import { CustomerError, inviteCustomer } from "@/lib/customer-records";
import { emailEnabled } from "@/lib/email";
import { getForm } from "@/lib/forms";
import { jsonError, readJsonCapped, requireAdmin } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string; customerId: string }> };

const body = z.object({
  /** The form the personal link opens; the default form when null. */
  formId: z.string().min(1).max(64).nullable().default(null),
  send: z.boolean().default(true),
});

/** INBOX-12 "Invite to a form" / "Ask for a video": a personal request link for this person, emailed when `send` is on. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id, customerId } = await ctx.params;
  const project = getProjectById(id);
  if (!project) return jsonError(404, "Project not found");
  const raw = await readJsonCapped(req, 4096);
  if (raw instanceof Response) return raw;
  const parsed = body.safeParse(raw ?? {});
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  if (parsed.data.formId && getForm(parsed.data.formId)?.projectId !== project.id) return jsonError(404, "Form not found");
  if (parsed.data.send && !emailEnabled()) {
    return jsonError(409, "Email isn't set up on this server (SMTP_URL), so the invitation can't be sent. Create the link and share it yourself.");
  }
  try {
    return Response.json({ request: inviteCustomer(project, customerId, parsed.data) }, { status: 201 });
  } catch (err) {
    if (err instanceof CustomerError) return jsonError(err.status, err.message);
    throw err;
  }
}
