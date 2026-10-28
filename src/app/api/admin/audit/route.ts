import { auditFacets, auditToJson, listAudit } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { featureOn } from "@/lib/features";
import { jsonError, requireRole } from "@/lib/http";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * TEAM-02: the audit log, newest first, for admins. Filters: `action` (one,
 * or a prefix ending in "." such as `testimonial.`), `actor`, `project`,
 * `object`, `from`/`to` (YYYY-MM-DD). `?format=csv` downloads what matches
 * (up to 10,000 rows).
 */
export async function GET(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  if (!featureOn("team2")) return jsonError(404, "The audit log is switched off on this server (team2)");
  const q = new URL(req.url).searchParams;
  for (const k of ["from", "to"]) if (q.get(k) && !DAY.test(q.get(k)!)) return jsonError(400, `${k} must be a date such as 2026-10-01`);
  const filter = { action: q.get("action"), actor: q.get("actor"), projectId: q.get("project"), objectId: q.get("object"), from: q.get("from"), to: q.get("to") };
  if (q.get("format") === "csv") {
    const { rows } = listAudit(filter, { limit: 10_000, offset: 0 });
    const head = ["at", "actor_type", "actor", "action", "object_type", "object_id", "project_id", "summary"];
    const csv = toCsv(head, rows.map((r) => [r.at.toISOString(), r.actorType, r.actorLabel, r.action, r.objectType, r.objectId, r.projectId, r.summary]));
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="plaudit-audit-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" },
    });
  }
  const limit = Math.min(Math.max(Number(q.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(q.get("offset")) || 0, 0);
  const { rows, total } = listAudit(filter, { limit, offset });
  return Response.json({ entries: rows.map(auditToJson), total, limit, offset, ...auditFacets() });
}
