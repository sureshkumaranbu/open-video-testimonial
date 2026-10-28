import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, gt, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Upload, UploadKind } from "@/db/schema";
import { claimDirect, completeDirect, DirectUploadError, dropDirect } from "./direct-upload";
import { env } from "./env";
import { isVideoMime, saveFile, sniffMime, UNSUPPORTED_VIDEO, UnsupportedMediaError, UploadError, type MediaKind } from "./storage";
import { tooLarge } from "./sniff";

const { uploads } = schema;

/**
 * Resumable uploads: the browser creates a session, then appends the file in
 * order, one chunk per request. If a request fails it asks for the current
 * offset and carries on from there. Large videos never travel as one request,
 * so reverse-proxy body limits stop mattering, and a dropped phone connection
 * doesn't lose the recording. A direct session (L9, src/lib/direct-upload.ts)
 * sends the bytes to the bucket instead, and can fall back to this path.
 */
export const CHUNK_MAX_BYTES = 8 * 1024 * 1024;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

function partPath(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new UploadError("Invalid upload id");
  return path.join(env.tmpDir, `${id}.part`);
}

/** How many unfinished public uploads one project may have at once. */
export const MAX_OPEN_UPLOADS_PER_PROJECT = 50;

export function openUploadCount(projectId: string) {
  return getDb()
    .select({ id: uploads.id })
    .from(uploads)
    .where(and(eq(uploads.projectId, projectId), gt(uploads.expiresAt, new Date())))
    .all().length;
}

/** `direct` asks for a direct-to-S3 session (L9; see directRequest), with the type its parts are pinned to. */
export function createUpload(kind: UploadKind, opts: { projectId?: string; maxBytes: number; direct?: { contentType: string } }) {
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
      direct: Boolean(opts.direct),
      contentType: opts.direct?.contentType ?? null,
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

// Appends (and direct completions) for one upload run one after another, so
// concurrent retries can't interleave bytes.
const locks = new Map<string, Promise<unknown>>();

async function serially<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  locks.set(id, run);
  try {
    return await run;
  } finally {
    if (locks.get(id) === run) locks.delete(id);
  }
}

export function appendChunk(upload: Upload, offset: number, bytes: Uint8Array) {
  return serially(upload.id, () => doAppend(upload.id, offset, bytes));
}

/**
 * L9: finishes a direct upload (see completeDirect) and returns its size. A
 * file that's refused takes the session with it, as on the relayed path.
 */
export function completeUpload(upload: Upload) {
  return serially(upload.id, async () => {
    const row = getDb().select().from(uploads).where(eq(uploads.id, upload.id)).get();
    if (!row) throw new UploadError("Upload not found");
    try {
      return await completeDirect(row);
    } catch (err) {
      // A refused file goes; a bucket that didn't answer can be retried.
      if (err instanceof DirectUploadError && err.status !== 409) await discardUpload(row.id);
      throw err;
    }
  });
}

async function doAppend(id: string, offset: number, bytes: Uint8Array) {
  const row = getDb().select().from(uploads).where(eq(uploads.id, id)).get();
  if (!row) throw new UploadError("Upload not found");
  if (bytes.byteLength > CHUNK_MAX_BYTES) throw new UploadError("Chunk too large");
  // Claimed or abandoned while this request was waiting: don't recreate the file.
  if (!fs.existsSync(partPath(id))) throw new UploadError("Upload not found");
  if (row.direct) {
    // L9 fallback: the browser couldn't reach the bucket (CORS, usually), so
    // it sends the file here from the start instead.
    if (offset !== 0) throw new OffsetMismatch(0);
    await dropDirect(row);
    Object.assign(row, getDb().update(uploads).set({ direct: false, s3UploadId: null, received: 0 }).where(eq(uploads.id, id)).returning().get());
  }
  if (offset !== row.received) throw new OffsetMismatch(row.received);
  if (row.received + bytes.byteLength > row.maxBytes) {
    await discardUpload(id);
    throw new UploadError(tooLarge(row.maxBytes));
  }
  // A video's first bytes say what it is: refuse anything else now, rather
  // than after the whole file has arrived. (Every container we accept is
  // recognisable from its first 12 bytes.)
  if (row.kind === "video" && offset === 0 && bytes.byteLength >= 12 && !isVideoMime(sniffMime(bytes.subarray(0, 16)))) {
    await discardUpload(id);
    throw new UnsupportedMediaError(UNSUPPORTED_VIDEO);
  }
  await fs.promises.appendFile(partPath(id), bytes);
  const received = row.received + bytes.byteLength;
  getDb().update(uploads).set({ received }).where(eq(uploads.id, id)).run();
  return received;
}

export async function discardUpload(id: string) {
  const row = getDb().delete(uploads).where(eq(uploads.id, id)).returning().get();
  await fs.promises.rm(partPath(id), { force: true });
  if (row?.direct) await dropDirect(row);
}

/**
 * Turns a finished upload into stored media: checks the real file type and
 * moves it into the uploads directory. The session is consumed either way.
 */
export async function claimUpload(upload: Upload, kind: MediaKind) {
  // Wait for any append still writing to this upload.
  await locks.get(upload.id)?.catch(() => undefined);
  const file = partPath(upload.id);
  try {
    const row = getDb().select().from(uploads).where(eq(uploads.id, upload.id)).get();
    if (row?.direct) return await claimDirect(row, kind);
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
