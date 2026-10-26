import { requireAdmin } from "@/lib/http";
import { FORM_TEMPLATES } from "@/lib/forms/templates";

/** The starting points offered when making a form (FORM-18). */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return Response.json({ templates: FORM_TEMPLATES.map(({ id, name, description }) => ({ id, name, description })) });
}
