import { z } from "zod";
import { emailEnabled } from "@/lib/email";
import { getForm, listForms } from "@/lib/forms";
import { jsonError, requireRole } from "@/lib/http";
import { createRequests, listRequests, parseRecipients, withLink } from "@/lib/requests";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** Everyone asked for a testimonial in this project, with their personal links. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  return Response.json({
    email: emailEnabled(),
    // Campaign recipients are on the campaign's own page.
    requests: listRequests(project.id, { campaignId: null }).map((r) => withLink(project, r)),
    // For the form picker: which form a new batch of links opens.
    forms: listForms(project.id).map((f) => ({ id: f.id, name: f.name, isDefault: f.isDefault, status: f.status })),
  });
}

const bodySchema = z.object({
  /** Pasted lines or CSV text. */
  recipients: z.string().max(500_000),
  send: z.boolean().default(false),
  /** The form the links open; the default form when left out. */
  formId: z.string().max(64).nullish(),
});

/** Creates requests from pasted lines or CSV, and optionally emails them. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  if (parsed.data.send && !emailEnabled()) {
    return jsonError(409, "Email isn't set up on this server (SMTP_URL), so invitations can't be sent. Create the links and share them yourself.");
  }
  const form = parsed.data.formId ? getForm(parsed.data.formId) : null;
  if (parsed.data.formId && form?.projectId !== project.id) return jsonError(404, "Form not found");
  const { valid, invalid } = parseRecipients(parsed.data.recipients);
  if (valid.length === 0) return jsonError(400, "No valid email addresses found");
  if (valid.length > 1000) return jsonError(400, "Add at most 1,000 people at a time");
  const { created, skipped } = createRequests(project, valid, { send: parsed.data.send, formId: form?.id ?? null });
  return Response.json(
    { created: created.map((r) => withLink(project, r)), skipped, invalid },
    { status: 201 },
  );
}
