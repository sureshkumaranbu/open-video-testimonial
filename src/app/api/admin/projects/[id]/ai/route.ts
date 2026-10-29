import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { aiEnabled } from "@/lib/ai";
import { auditRequest } from "@/lib/audit";
import { jsonError, readJsonCapped, requireRole } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";

/**
 * M17: "AI in this project" `{enabled}`. Off keeps every one of the
 * project's testimonials, survey answers and screenshots away from the
 * server's AI provider. Admins only: it decides what leaves the server.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const body = await readJsonCapped(req);
  if (body instanceof Response) return body;
  const enabled = (body as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== "boolean") return jsonError(400, "Send {enabled: true|false}");
  getDb().update(schema.projects).set({ aiEnabled: enabled }).where(eq(schema.projects.id, project.id)).run();
  auditRequest(req, enabled ? "project.ai_on" : "project.ai_off", { objectType: "project", objectId: project.id, projectId: project.id, summary: `Turned AI ${enabled ? "on" : "off"} for this project` });
  return Response.json({ aiEnabled: enabled, serverAi: aiEnabled() });
}
