import crypto from "node:crypto";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ShareAsset, ShareAssetKind, ShareTemplate } from "@/db/schema";
import { fileInUse } from "../projects";
import { mediaUrl, removeFiles, saveUpload, sniffMime, UnsupportedMediaError } from "../storage";
import { firstIssue } from "../validation";
import { shareDesignSchema, type ShareDesign } from "./design";

const { shareAssets, shareTemplates } = schema;

/**
 * The image studio's own rows (SHARE-01, SHARE-02): uploaded backgrounds and
 * logos, and "my templates". Both belong to a project and go with it.
 * Uploads are owner-only media (never public): the server draws them.
 */

export class ShareStoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const MAX_ASSETS_PER_PROJECT = 100;
export const MAX_TEMPLATES_PER_PROJECT = 50;

export function assetToAdmin(a: ShareAsset) {
  return { id: a.id, kind: a.kind, url: mediaUrl(a.key)!, createdAt: a.createdAt.toISOString() };
}

export function listAssets(projectId: string): ShareAsset[] {
  return getDb().select().from(shareAssets).where(eq(shareAssets.projectId, projectId)).orderBy(desc(shareAssets.createdAt)).all();
}

export function getAsset(id: string): ShareAsset | null {
  return getDb().select().from(shareAssets).where(eq(shareAssets.id, id)).get() ?? null;
}

/**
 * Stores an uploaded background or logo. Only PNG or JPEG (sniffed from the
 * bytes, never the name or type), because those are what the renderer draws;
 * the size cap is the one for every image (MAX_IMAGE_MB).
 */
export async function addAsset(projectId: string, kind: ShareAssetKind, file: File): Promise<ShareAsset> {
  const n = getDb().select({ n: count() }).from(shareAssets).where(eq(shareAssets.projectId, projectId)).get()!.n;
  if (n >= MAX_ASSETS_PER_PROJECT) throw new ShareStoreError(409, `A project keeps up to ${MAX_ASSETS_PER_PROJECT} studio uploads. Delete some first.`);
  const mime = sniffMime(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (mime !== "image/png" && mime !== "image/jpeg") throw new UnsupportedMediaError("Choose a PNG or JPEG image.");
  const stored = await saveUpload(file, "image");
  return getDb()
    .insert(shareAssets)
    .values({ id: crypto.randomUUID(), projectId, kind, key: stored.key, createdAt: new Date() })
    .returning()
    .get();
}

/** Deletes the upload and its file (unless something else uses the file). Templates that used it fall back to none. */
export async function deleteAsset(id: string): Promise<boolean> {
  const row = getDb().delete(shareAssets).where(eq(shareAssets.id, id)).returning().get();
  if (!row) return false;
  if (!fileInUse(row.key)) await removeFiles([row.key]);
  return true;
}

// ------------------------------------------------------------------ templates

function parseDesign(raw: string): ShareDesign {
  try {
    const r = shareDesignSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : shareDesignSchema.parse({});
  } catch {
    return shareDesignSchema.parse({});
  }
}

export function templateToAdmin(t: ShareTemplate) {
  return { id: t.id, name: t.name, design: parseDesign(t.design), createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() };
}
export type AdminShareTemplate = ReturnType<typeof templateToAdmin>;

export function listShareTemplates(projectId: string): ShareTemplate[] {
  return getDb().select().from(shareTemplates).where(eq(shareTemplates.projectId, projectId)).orderBy(asc(shareTemplates.name), asc(shareTemplates.createdAt)).all();
}

export function getShareTemplate(id: string): ShareTemplate | null {
  return getDb().select().from(shareTemplates).where(eq(shareTemplates.id, id)).get() ?? null;
}

function checkDesign(input: unknown): ShareDesign {
  const r = shareDesignSchema.safeParse(input);
  if (!r.success) throw new ShareStoreError(400, firstIssue(r.error));
  return r.data;
}

/** Studio uploads a design points at must be this project's. */
function checkAssets(projectId: string, d: ShareDesign) {
  for (const id of [d.background.assetId, d.logo.assetId]) {
    if (!id) continue;
    const a = getAsset(id);
    if (!a || a.projectId !== projectId) throw new ShareStoreError(400, "That image isn't one of this project's uploads");
  }
}

export function createShareTemplate(projectId: string, name: string, design: unknown): ShareTemplate {
  const d = checkDesign(design);
  checkAssets(projectId, d);
  const n = getDb().select({ n: count() }).from(shareTemplates).where(eq(shareTemplates.projectId, projectId)).get()!.n;
  if (n >= MAX_TEMPLATES_PER_PROJECT) throw new ShareStoreError(409, `A project keeps up to ${MAX_TEMPLATES_PER_PROJECT} templates. Delete one first.`);
  const now = new Date();
  return getDb()
    .insert(shareTemplates)
    .values({ id: crypto.randomUUID(), projectId, name: name.trim() || "My template", design: JSON.stringify(d), createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function updateShareTemplate(id: string, p: { name?: string; design?: unknown }): ShareTemplate | null {
  const t = getShareTemplate(id);
  if (!t) return null;
  const set: Partial<typeof shareTemplates.$inferInsert> = { updatedAt: new Date() };
  if (p.name !== undefined) set.name = p.name.trim() || t.name;
  if (p.design !== undefined) {
    const d = checkDesign(p.design);
    checkAssets(t.projectId, d);
    set.design = JSON.stringify(d);
  }
  return getDb().update(shareTemplates).set(set).where(eq(shareTemplates.id, id)).returning().get() ?? null;
}

export function deleteShareTemplate(id: string): boolean {
  return Boolean(getDb().delete(shareTemplates).where(and(eq(shareTemplates.id, id))).returning().get());
}
