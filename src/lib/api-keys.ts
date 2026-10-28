import crypto from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ApiKey, ApiKeyScope } from "@/db/schema";
import { jsonError } from "./http";
import { rateLimit } from "./rate-limit";

const { apiKeys, apiKeyProjects } = schema;

/**
 * REST API keys: `plk_` + 32 random bytes. Only a SHA-256 hash is stored (the
 * key is random, so a slow hash adds nothing), and the key is shown once.
 */
const hash = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

/** A new key; `projectIds` limits it to those projects (TEAM-01), null or absent reaches every project. */
export function createApiKey(name: string, scope: ApiKeyScope, projectIds: string[] | null = null) {
  const key = `plk_${crypto.randomBytes(32).toString("base64url")}`;
  const db = getDb();
  const row = db.transaction((tx) => {
    const r = tx
      .insert(apiKeys)
      .values({ id: crypto.randomUUID(), name, scope, prefix: key.slice(0, 12), keyHash: hash(key), createdAt: new Date(), allProjects: projectIds === null })
      .returning()
      .get();
    const valid = projectIds?.length ? tx.select({ id: schema.projects.id }).from(schema.projects).where(inArray(schema.projects.id, projectIds)).all() : [];
    for (const p of valid) tx.insert(apiKeyProjects).values({ apiKeyId: r.id, projectId: p.id }).run();
    return r;
  });
  return { key, row };
}

export function listApiKeys() {
  const db = getDb();
  const rows = db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scope: apiKeys.scope,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      allProjects: apiKeys.allProjects,
    })
    .from(apiKeys)
    .orderBy(desc(apiKeys.createdAt))
    .all();
  const links = db.select().from(apiKeyProjects).all();
  return rows.map(({ allProjects, ...r }) => ({ ...r, projectIds: allProjects ? null : links.filter((l) => l.apiKeyId === r.id).map((l) => l.projectId) }));
}

/** TEAM-01: whether a key may reach a project (keys made before 0017, and any made without a list, reach all). */
export function apiKeyReaches(key: Pick<ApiKey, "id" | "allProjects">, projectId: string): boolean {
  if (key.allProjects) return true;
  return Boolean(getDb().select().from(apiKeyProjects).where(and(eq(apiKeyProjects.apiKeyId, key.id), eq(apiKeyProjects.projectId, projectId))).get());
}

export function revokeApiKey(id: string) {
  return getDb().update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id)).returning().get() ?? null;
}

const API_HEADERS = { "Cache-Control": "no-store" };

/**
 * Authenticates a REST API request. Returns the key, or an error Response.
 * `write` routes need a key with the write scope.
 */
export function requireApiKey(req: Request, need: ApiKeyScope) {
  const header = req.headers.get("authorization")?.trim() ?? "";
  if (!header) return { error: jsonError(401, "Missing API key (Authorization: Bearer plk_…)", API_HEADERS) };
  const match = /^Bearer\s+(plk_[A-Za-z0-9_-]{20,})$/.exec(header);
  if (!match) return { error: jsonError(401, "Invalid API key (Authorization: Bearer plk_…)", API_HEADERS) };
  const key = getDb().select().from(apiKeys).where(eq(apiKeys.keyHash, hash(match[1]))).get();
  if (!key || key.revokedAt) return { error: jsonError(401, "Invalid or revoked API key", API_HEADERS) };
  if (need === "write" && key.scope !== "write") {
    return { error: jsonError(403, "This API key is read-only", API_HEADERS) };
  }
  if (!rateLimit(`api:${key.id}`, 600, 60 * 1000)) {
    return { error: jsonError(429, "Rate limit: 600 requests per minute per key", { ...API_HEADERS, "Retry-After": "60" }) };
  }
  // Record use at most once a minute to keep writes down.
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    getDb().update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id)).run();
  }
  return { key };
}

export function apiJson(data: unknown, status = 200) {
  return Response.json(data, { status, headers: API_HEADERS });
}
