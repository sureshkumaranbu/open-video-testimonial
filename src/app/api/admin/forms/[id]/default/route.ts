import { setDefaultForm } from "@/lib/forms";
import { requireRole } from "@/lib/http";
import { formErrorResponse, formResponse, loadForm } from "../shared";

/** Makes this the project's default form (what /c and requests without a form open). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const found = loadForm(id);
  if (found instanceof Response) return found;
  try {
    setDefaultForm(found.form.projectId, id);
  } catch (err) {
    return formErrorResponse(err);
  }
  return formResponse(id);
}
