import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { analyticsCspHosts, parseWallConfigLenient } from "./wall-config";

const { projects, walls } = schema;

/**
 * WALL-07: the extra CSP hosts for one wall page, looked up from its path
 * (/wall/<project> is the main wall, /wall/<project>/<wall> any published
 * one). Kept to two small queries so src/proxy.ts can run it on every wall
 * request; old slugs redirect, so they need nothing. Never throws: on any
 * problem the page gets the plain public policy.
 */
export function wallCspExtra(pathname: string): { script: string[]; connect: string[]; img: string[] } | undefined {
  const m = /^\/wall\/([^/]+)(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!m) return undefined;
  try {
    const db = getDb();
    const project = db.select({ id: projects.id }).from(projects).where(eq(projects.slug, decodeURIComponent(m[1]))).get();
    if (!project) return undefined;
    const wall = m[2]
      ? db.select({ config: walls.config }).from(walls).where(and(eq(walls.projectId, project.id), eq(walls.slug, decodeURIComponent(m[2])), eq(walls.published, true))).get()
      : db.select({ config: walls.config }).from(walls).where(and(eq(walls.projectId, project.id), eq(walls.isMain, true), eq(walls.published, true))).get();
    if (!wall) return undefined;
    let raw: unknown = {};
    try {
      raw = JSON.parse(wall.config);
    } catch {
      raw = {};
    }
    const hosts = analyticsCspHosts(parseWallConfigLenient(raw).head);
    return hosts.script.length ? hosts : undefined;
  } catch (err) {
    console.error("[csp] couldn't read a wall's analytics setting:", err);
    return undefined;
  }
}
