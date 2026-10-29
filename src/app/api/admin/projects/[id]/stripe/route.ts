import { auditRequest } from "@/lib/audit";
import { deletePurchases, purchaseCount, purchaseToAdmin, recentPurchases } from "@/lib/commerce/purchases";
import { connectionBody, connectionToAdmin, deleteConnection, getConnection, saveConnection } from "@/lib/commerce/stripe-connection";
import { featureOn } from "@/lib/features";
import { jsonError, readJsonCapped, requireRole } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/**
 * INT-07: the project's Stripe connection (its webhook URL and settings,
 * never its secrets) and the purchases it has recorded, as stored. Viewers
 * may look; changing it is for admins, like webhooks and API keys.
 */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  if (!featureOn("commerce")) return jsonError(404, "Not found");
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const c = getConnection(project.id);
  return Response.json(
    { connection: connectionToAdmin(c), purchases: c ? recentPurchases(project.id, { limit: 20 }).map(purchaseToAdmin) : [], purchaseCount: purchaseCount(project.id) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/** Saves `{signingSecret?, restrictedKey?, enabled?, retentionDays?, verifyPurchases?, defaultProduct?}`; makes the connection the first time. */
export async function PUT(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  if (!featureOn("commerce")) return jsonError(404, "Not found");
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const input = await readJsonCapped(req);
  if (input instanceof Response) return input;
  const parsed = connectionBody.safeParse(input ?? {});
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const before = getConnection(project.id);
  const c = saveConnection(project.id, parsed.data);
  const changed = Object.keys(parsed.data).map((k) => (k === "signingSecret" || k === "restrictedKey" ? `${k} (${parsed.data[k] ? "set" : "cleared"})` : k));
  auditRequest(req, before ? "stripe_connection.update" : "stripe_connection.create", {
    objectType: "stripe_connection",
    objectId: c.id,
    projectId: project.id,
    summary: `${before ? "Changed" : "Connected"} the project's Stripe connection`,
    // Never the secrets themselves: only which fields changed.
    meta: { changed },
  });
  return Response.json({ connection: connectionToAdmin(c) }, { status: before ? 200 : 201 });
}

/** Disconnects Stripe: the connection and every purchase it recorded go ("Verified purchase" marks stay). */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  if (!featureOn("commerce")) return jsonError(404, "Not found");
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const c = deleteConnection(project.id);
  if (!c) return jsonError(404, "This project has no Stripe connection");
  const removed = deletePurchases(project.id);
  auditRequest(req, "stripe_connection.delete", { objectType: "stripe_connection", objectId: c.id, projectId: project.id, summary: `Disconnected Stripe and deleted ${removed} purchase${removed === 1 ? "" : "s"}` });
  return new Response(null, { status: 204 });
}
