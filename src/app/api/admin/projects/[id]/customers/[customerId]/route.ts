import { CustomerError, customerPatchSchema, customerProfile, updateCustomer } from "@/lib/customer-records";
import { jsonError, readJsonCapped, requireRole } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string; customerId: string }> };

/** INBOX-12: one customer's profile: testimonials, private feedback, invitations and rewards. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const { id, customerId } = await ctx.params;
  const project = getProjectById(id);
  if (!project) return jsonError(404, "Project not found");
  const profile = customerProfile(project, customerId);
  if (!profile) return jsonError(404, "Customer not found");
  return Response.json(profile);
}

/** Edits the person's name, email, job title, company or website. Their testimonials stay as they wrote them. */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id, customerId } = await ctx.params;
  const project = getProjectById(id);
  if (!project) return jsonError(404, "Project not found");
  const body = await readJsonCapped(req);
  if (body instanceof Response) return body;
  const parsed = customerPatchSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    const c = updateCustomer(project.id, customerId, parsed.data);
    return Response.json({ customer: customerProfile(project, c.id)!.customer });
  } catch (err) {
    if (err instanceof CustomerError) return jsonError(err.status, err.message);
    throw err;
  }
}
