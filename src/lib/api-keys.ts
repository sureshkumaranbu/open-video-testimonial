import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ApiKeyScope } from "@/db/schema";
import { jsonError } from "./http";
import { rateLimit } from "./rate-limit";

const { apiKeys } = schema;

/**
 * REST API keys: `plk_` + 32 random bytes. Only a SHA-256 hash is stored (the
 * key is random, so a slow hash adds nothing), and the key is shown once.
 */
const hash = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

export function createApiKey(name: string, scope: ApiKeyScope) {
  const key = `plk_${crypto.randomBytes(32).toString("base64url")}`;
  const row = getDb()
    .insert(apiKeys)
    .values({ id: crypto.randomUUID(), name, scope, prefix: key.slice(0, 12), keyHash: hash(key), createdAt: new Date() })
    .returning()
    .get();
  return { key, row };
}

export function listApiKeys() {
  return getDb()
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scope: apiKeys.scope,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .orderBy(desc(apiKeys.createdAt))
    .all();
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
