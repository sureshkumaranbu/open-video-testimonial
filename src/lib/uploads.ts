import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Upload, UploadKind } from "@/db/schema";
import { env } from "./env";
import { saveFile, sniffMime, UploadError, type MediaKind } from "./storage";

const { uploads } = schema;

/**
 * Resumable uploads: the browser creates a session, then appends the file in
 * order, one chunk per request. If a request fails it asks for the current
 * offset and carries on from there. Large videos never travel as one request,
 * so reverse-proxy body limits stop mattering, and a dropped phone connection
 * doesn't lose the recording.
 */
export const CHUNK_MAX_BYTES = 8 * 1024 * 1024;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

function partPath(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new UploadError("Invalid upload id");
  return path.join(env.tmpDir, `${id}.part`);
}

export function createUpload(kind: UploadKind, opts: { projectId?: string; maxBytes: number }) {
  const token = crypto.randomBytes(24).toString("base64url");
  const now = new Date();
  const row = getDb()
    .insert(uploads)
    .values({
      id: crypto.randomUUID(),
      kind,
      projectId: opts.projectId ?? null,
      tokenHash: hash(token),
      maxBytes: opts.maxBytes,
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    })
    .returning()
    .get();
  fs.mkdirSync(env.tmpDir, { recursive: true });
  fs.writeFileSync(partPath(row.id), new Uint8Array());
  return { upload: row, token };
}

/** Returns the session if the token matches and it hasn't expired. */
export function getUpload(id: string, token: string | null | undefined): Upload | null {
  if (!token || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const row = getDb().select().from(uploads).where(eq(uploads.id, id)).get();
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  const a = Buffer.from(row.tokenHash);
  const b = Buffer.from(hash(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? row : null;
}

export class OffsetMismatch extends Error {
  constructor(readonly expected: number) {
    super("Offset mismatch");
  }
}

// Appends for one upload run one after another, so concurrent retries can't
// interleave bytes.
const locks = new Map<string, Promise<unknown>>();

export async function appendChunk(upload: Upload, offset: number, bytes: Uint8Array) {
  const previous = locks.get(upload.id) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => doAppend(upload.id, offset, bytes));
  locks.set(upload.id, run);
  try {
    return await run;
  } finally {
    if (locks.get(upload.id) === run) locks.delete(upload.id);
  }
}

async function doAppend(id: string, offset: number, bytes: Uint8Array) {
  const row = getDb().select().from(uploads).where(eq(uploads.id, id)).get();
  if (!row) throw new UploadError("Upload not found");
  if (bytes.byteLength > CHUNK_MAX_BYTES) throw new UploadError("Chunk too large");
  if (offset !== row.received) throw new OffsetMismatch(row.received);
  if (row.received + bytes.byteLength > row.maxBytes) {
    await discardUpload(id);
    throw new UploadError(`The file is larger than ${Math.round(row.maxBytes / 1024 / 1024)} MB`);
  }
  await fs.promises.appendFile(partPath(id), bytes);
  const received = row.received + bytes.byteLength;
  getDb().update(uploads).set({ received }).where(eq(uploads.id, id)).run();
  return received;
}

export async function discardUpload(id: string) {
  getDb().delete(uploads).where(eq(uploads.id, id)).run();
  await fs.promises.rm(partPath(id), { force: true });
}

/**
 * Turns a finished upload into stored media: checks the real file type and
 * moves it into the uploads directory. The session is consumed either way.
 */
export async function claimUpload(upload: Upload, kind: MediaKind) {
  const file = partPath(upload.id);
  try {
    if (upload.received === 0) throw new UploadError(`The ${kind} file is empty`);
    const head = Buffer.alloc(16);
    const fd = await fs.promises.open(file, "r");
    try {
      await fd.read(head, 0, 16, 0);
    } finally {
      await fd.close();
    }
    return await saveFile(file, sniffMime(head), kind, { move: true });
  } finally {
    await discardUpload(upload.id);
  }
}

/** Path of an upload's bytes, for importers that read the file in place. */
export function uploadFilePath(upload: Upload) {
  return partPath(upload.id);
}

/** Removes sessions nobody finished. Run periodically by the worker. */
export async function cleanupExpiredUploads(now = new Date()) {
  const expired = getDb().select().from(uploads).where(lte(uploads.expiresAt, now)).all();
  for (const row of expired) await discardUpload(row.id);
  return expired.length;
}
