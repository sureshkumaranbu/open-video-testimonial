import { upgradeToSteps } from "@/lib/forms";
import { requireAdmin } from "@/lib/http";
import { formErrorResponse, formResponse } from "../shared";

/** Classic → step by step (D1). For the default form, /c then sends visitors to its /f page. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    upgradeToSteps(id);
  } catch (err) {
    return formErrorResponse(err);
  }
  return formResponse(id);
}
