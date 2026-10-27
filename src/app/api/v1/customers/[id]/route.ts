import { apiJson } from "@/lib/api-keys";
import { apiError, customerToApi, getCustomer, projectOfRow, requireApi2 } from "@/lib/api-v1";

/** GET /api/v1/customers/:id (API-01, read) */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApi2(req, "read");
  if (auth.error) return auth.error;
  const c = getCustomer((await ctx.params).id);
  if (!c || !projectOfRow(auth.key, c)) return apiError(404, "Customer not found");
  return apiJson({ data: customerToApi(c) });
}
