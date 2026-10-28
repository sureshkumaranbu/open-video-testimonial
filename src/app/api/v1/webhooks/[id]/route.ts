import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { apiJson } from "@/lib/api-keys";
import { apiError, requireApi2 } from "@/lib/api-v1";
import { audit, keyActor } from "@/lib/audit";

/** DELETE /api/v1/webhooks/:id (write): unsubscribes. Only the key that made a subscription can remove it this way. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApi2(req, "write");
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  const gone = getDb()
    .delete(schema.webhooks)
    .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.apiKeyId, auth.key.id)))
    .returning()
    .get();
  if (!gone) return apiError(404, "Subscription not found");
  audit(keyActor(auth.key), "webhook.delete", { objectType: "webhook", objectId: id, projectId: gone.projectId, meta: { via: "api" } });
  return apiJson({ ok: true });
}
