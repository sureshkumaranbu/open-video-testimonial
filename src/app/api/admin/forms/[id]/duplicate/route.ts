import { duplicateForm } from "@/lib/forms";
import { jsonError, requireRole } from "@/lib/http";
import { formResponse } from "../shared";

/** A step-by-step copy named "<name> (copy)" with its own link. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const copy = duplicateForm((await ctx.params).id);
  return copy ? formResponse(copy.id, 201) : jsonError(404, "Form not found");
}
