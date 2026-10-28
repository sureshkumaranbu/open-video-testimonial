import crypto from "node:crypto";
import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ApiKey, AuditActorType, AuditEntry } from "@/db/schema";
import { getRequestSession } from "./auth";
import { env } from "./env";
import { featureOn } from "./features";
import { registerPeriodic } from "./jobs";

const { auditLog } = schema;

/**
 * TEAM-02: the audit log (flag `team2`). Who approved, edited, deleted or
 * exported what, and every change to the team, API keys, webhooks and MCP
 * grants. Writing never throws (a failed log line must not undo the action)
 * and never stores secrets, IP addresses or user agents.
 */

export type Actor = { type: AuditActorType; id: string; label: string };

export const memberActor = (email: string): Actor => ({ type: "member", id: email, label: email });
export const keyActor = (key: Pick<ApiKey, "id" | "name" | "prefix">): Actor => ({ type: "api_key", id: key.id, label: `API key “${key.name}” (${key.prefix}…)` });
export const SYSTEM: Actor = { type: "system", id: "system", label: "Plaudit" };

/** The signed-in person behind a dashboard request. */
export function requestActor(req: Request): Actor {
  const s = getRequestSession(req);
  return s ? memberActor(s.email) : SYSTEM;
}

export type AuditInput = { objectType?: string; objectId?: string | null; projectId?: string | null; summary?: string; meta?: Record<string, unknown> };

export function audit(actor: Actor, action: string, o: AuditInput = {}) {
  if (!featureOn("team2")) return;
  try {
    getDb()
      .insert(auditLog)
      .values({
        id: crypto.randomUUID(),
        at: new Date(),
        actorType: actor.type,
        actorId: actor.id.slice(0, 254),
        actorLabel: actor.label.slice(0, 254),
        action: action.slice(0, 64),
        objectType: o.objectType ?? null,
        objectId: o.objectId ?? null,
        projectId: o.projectId ?? null,
        summary: (o.summary ?? "").slice(0, 300),
        meta: JSON.stringify(o.meta ?? {}).slice(0, 4000),
      })
      .run();
  } catch (err) {
    console.error("[audit] couldn't record", action, (err as Error).message);
  }
}

export type AuditFilter = {
  action?: string | null;
  actor?: string | null;
  projectId?: string | null;
  objectId?: string | null;
  /** YYYY-MM-DD, UTC, both included. */
  from?: string | null;
  to?: string | null;
  /** Only these projects (and entries about no project), for someone limited to some. */
  projectIds?: string[] | null;
};

function where(f: AuditFilter) {
  const c = [];
  if (f.action) c.push(f.action.endsWith(".") ? sql`${auditLog.action} LIKE ${`${f.action}%`}` : eq(auditLog.action, f.action));
  if (f.actor) c.push(eq(auditLog.actorId, f.actor));
  if (f.projectId) c.push(eq(auditLog.projectId, f.projectId));
  if (f.objectId) c.push(eq(auditLog.objectId, f.objectId));
  if (f.from) c.push(gte(auditLog.at, new Date(`${f.from}T00:00:00Z`)));
  if (f.to) c.push(lte(auditLog.at, new Date(`${f.to}T23:59:59.999Z`)));
  return c.length ? and(...c) : undefined;
}

export function listAudit(f: AuditFilter, page: { limit: number; offset: number }) {
  const db = getDb();
  const w = where(f);
  const total = db.select({ n: sql<number>`count(*)` }).from(auditLog).where(w).get()?.n ?? 0;
  const rows = db.select().from(auditLog).where(w).orderBy(desc(auditLog.at), desc(auditLog.id)).limit(page.limit).offset(page.offset).all();
  return { rows, total };
}

/** What the filters offer: the actions and people that appear in the log. */
export function auditFacets() {
  const db = getDb();
  return {
    actions: db.selectDistinct({ action: auditLog.action }).from(auditLog).orderBy(auditLog.action).all().map((r) => r.action),
    actors: db.selectDistinct({ id: auditLog.actorId, label: auditLog.actorLabel }).from(auditLog).orderBy(auditLog.actorLabel).limit(500).all(),
  };
}

export function auditToJson(e: AuditEntry) {
  let meta: unknown = {};
  try {
    meta = JSON.parse(e.meta);
  } catch {
    // leave empty
  }
  return { ...e, at: e.at.toISOString(), meta };
}

/** Deletes entries older than AUDIT_RETENTION_DAYS. */
export function pruneAudit(now = Date.now()) {
  return getDb().delete(auditLog).where(lt(auditLog.at, new Date(now - env.auditRetentionDays * 86_400_000))).run().changes;
}

export function registerAuditJobs() {
  registerPeriodic("audit.prune", 24 * 60 * 60 * 1000, () => pruneAudit());
}

/** Shorthand for a dashboard route: the signed-in person did `action`. */
export function auditRequest(req: Request, action: string, o: AuditInput = {}) {
  audit(requestActor(req), action, o);
}

/** A testimonial change, by what it did: a status change is its own action (testimonial.approved…). */
export function testimonialAction(patch: Record<string, unknown>): string[] {
  const fields = Object.keys(patch);
  const out: string[] = [];
  if (typeof patch.status === "string") out.push(`testimonial.${patch.status === "approved" ? "approve" : patch.status === "rejected" ? "reject" : patch.status === "hidden" ? "hide" : "pending"}`);
  if (fields.includes("tags")) out.push("testimonial.tag");
  if (fields.some((f) => f !== "status" && f !== "tags")) out.push("testimonial.edit");
  return out;
}
