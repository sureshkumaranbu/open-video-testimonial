import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Upload } from "@/db/schema";
import { env } from "./env";
import { sniffMime, tooLarge, UNSUPPORTED_VIDEO } from "./sniff";
import { checkType, newKey, s3Storage, UnsupportedMediaError, UploadError, type MediaKind } from "./storage";
import { bucketRootOf } from "./storage/s3";

const { uploads } = schema;

/**
 * L9 (TEAM-05's presigned uploads): with STORAGE_DRIVER=s3 and
 * S3_DIRECT_UPLOADS=true, a video's bytes go from the browser straight to the
 * bucket instead of through this server. The server still decides everything:
 *
 * - it presigns only for an upload session it created (the same id and token
 *   as resumable uploads), one part at a time, for the fixed key `tmp/<id>`,
 *   with each part's size and the declared type signed in, for ten minutes,
 *   and never past the session's size limit;
 * - on completion it checks every part, HEADs the object for its real size
 *   and sniffs its first bytes with a ranged GET. Anything that isn't a video
 *   (SVG, a photo, a renamed text file) is deleted;
 * - claiming copies it to `videos/<uuid>.<ext>` inside the bucket, so the
 *   rest of the pipeline (ffmpeg, transcripts, /api/media) is unchanged.
 *
 * Parts are always uploaded as a multipart upload, even a single one: once
 * it's completed no URL the browser holds can write to the object again, so
 * what was sniffed is what gets stored. If a presigned PUT fails (usually the
 * bucket's CORS), the browser falls back to the relayed path on the same session.
 */

/** Every part but the last is exactly this size (S3 needs at least 5 MiB). */
export const DIRECT_PART_BYTES = 8 * 1024 * 1024;
/** S3's limit. */
const MAX_PARTS = 10_000;
const PRESIGN_SECONDS = 10 * 60;

export const directUploadsOn = () => env.storageDriver === "s3" && env.s3DirectUploads;

/** The bucket's origin for public pages' `connect-src` while direct uploads are on; null otherwise. Never throws. */
export function directUploadOrigin(): string | null {
  if (!directUploadsOn()) return null;
  try {
    return new URL(bucketRootOf({ endpoint: env.s3Endpoint, bucket: env.s3Bucket, forcePathStyle: env.s3ForcePathStyle })).origin;
  } catch {
    return null;
  }
}

export const stagingKey = (upload: Pick<Upload, "id">) => `tmp/${upload.id}`;

const VIDEO_TYPES = ["video/webm", "video/mp4", "video/quicktime", "video/ogg"];

const askSchema = z.object({ direct: z.literal(true), contentType: z.string().max(200).optional() });

/**
 * Whether a create-upload request asks for (and may have) a direct upload,
 * and the type to pin. A type we don't take is pinned as
 * application/octet-stream: the sniff decides what the file really is.
 */
export function directRequest(body: unknown): { contentType: string } | undefined {
  if (!directUploadsOn()) return undefined;
  const parsed = askSchema.safeParse(body);
  if (!parsed.success) return undefined;
  const type = (parsed.data.contentType ?? "").split(";")[0].trim().toLowerCase();
  return { contentType: VIDEO_TYPES.includes(type) ? type : "application/octet-stream" };
}

/** A direct upload's declared size is its limit (never over `max`): the bucket gets no more than that. */
export function sessionLimit(direct: { contentType: string } | undefined, size: unknown, max: number) {
  return direct && typeof size === "number" && Number.isFinite(size) && size > 0 ? Math.min(Math.ceil(size), max) : max;
}

/**
 * Starts the bucket's multipart upload for a new direct session. If the bucket
 * can't be reached the session simply stays relayed, so the visitor notices nothing.
 */
export async function openDirect(upload: Upload): Promise<Upload> {
  if (!upload.direct) return upload;
  try {
    const id = await s3Storage().startMultipart(stagingKey(upload), upload.contentType ?? "application/octet-stream");
    return getDb().update(uploads).set({ s3UploadId: id }).where(eq(uploads.id, upload.id)).returning().get() ?? upload;
  } catch (err) {
    console.error("[uploads] couldn't start a direct upload, relaying this one:", err);
    return getDb().update(uploads).set({ direct: false }).where(eq(uploads.id, upload.id)).returning().get() ?? upload;
  }
}

/** What the browser needs to know about a direct session, for the create-upload reply. */
export const directReply = (upload: Upload) => (upload.direct && upload.s3UploadId ? { direct: { partSize: DIRECT_PART_BYTES } } : {});

/** A request the session can't satisfy; `status` is the HTTP answer. */
export class DirectUploadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A presigned PUT for one part. Parts are numbered from 1 and each covers
 * the next DIRECT_PART_BYTES of the file, so part n plus its size says how
 * far into the file it ends; past the session's limit is refused.
 */
export function presignPart(upload: Upload, partNumber: number, size: number) {
  if (!upload.direct || !upload.s3UploadId) throw new DirectUploadError(409, "This upload doesn't go straight to storage");
  if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) throw new DirectUploadError(400, "Invalid part number");
  if (!Number.isSafeInteger(size) || size < 1 || size > DIRECT_PART_BYTES) throw new DirectUploadError(400, "Invalid part size");
  if ((partNumber - 1) * DIRECT_PART_BYTES + size > upload.maxBytes) throw new DirectUploadError(413, tooLarge(upload.maxBytes));
  const contentType = upload.contentType ?? "application/octet-stream";
  const url = s3Storage().presignPart(stagingKey(upload), upload.s3UploadId, partNumber, size, contentType, PRESIGN_SECONDS);
  return { url, headers: { "Content-Type": contentType }, expiresIn: PRESIGN_SECONDS };
}

/** The first bytes of a staged object, enough for sniffMime. */
async function headOf(key: string) {
  const body = await s3Storage().read(key, { start: 0, end: 15 });
  return body ? new Uint8Array(await new Response(body).arrayBuffer()).subarray(0, 16) : new Uint8Array();
}

/**
 * Completes the bucket's upload once every part is there, then checks the
 * object: its real size and its first bytes. Returns the size. Throws a
 * DirectUploadError (the caller then discards the session, which deletes
 * whatever is in the bucket) when the parts or the file aren't acceptable.
 */
export async function completeDirect(upload: Upload): Promise<number> {
  if (!upload.direct) throw new DirectUploadError(409, "This upload doesn't go straight to storage");
  if (!upload.s3UploadId) {
    if (upload.received > 0) return upload.received; // completed already: a retried request
    throw new DirectUploadError(409, "This upload doesn't go straight to storage");
  }
  const s3 = s3Storage();
  const key = stagingKey(upload);
  const parts = await s3.listParts(key, upload.s3UploadId);
  if (!parts.length) throw new DirectUploadError(400, `The video file is empty`);
  const total = parts.reduce((sum, p) => sum + p.size, 0);
  const inOrder = parts.every((p, i) => p.partNumber === i + 1 && (i === parts.length - 1 ? p.size <= DIRECT_PART_BYTES : p.size === DIRECT_PART_BYTES));
  if (!inOrder) throw new DirectUploadError(400, "The upload's parts don't fit together. Please try again.");
  if (total > upload.maxBytes) throw new DirectUploadError(413, tooLarge(upload.maxBytes));
  await s3.completeMultipart(key, upload.s3UploadId, parts);
  // The parts are gone now; record that before checking, so a retry doesn't look for them.
  getDb().update(uploads).set({ s3UploadId: null }).where(eq(uploads.id, upload.id)).run();
  const stat = await s3.stat(key);
  if (!stat || stat.size !== total || stat.size > upload.maxBytes) throw new DirectUploadError(413, tooLarge(upload.maxBytes));
  try {
    checkType(sniffMime(await headOf(key)), "video");
  } catch (err) {
    if (err instanceof UnsupportedMediaError) throw new DirectUploadError(415, UNSUPPORTED_VIDEO);
    throw err;
  }
  getDb().update(uploads).set({ received: stat.size }).where(eq(uploads.id, upload.id)).run();
  return stat.size;
}

/**
 * Turns a completed direct upload into stored media: sniffs it once more to
 * pick its type and extension, then copies it to its media key and removes
 * the staged copy. The caller discards the session either way.
 */
export async function claimDirect(upload: Upload, kind: MediaKind) {
  const row = getDb().select().from(uploads).where(eq(uploads.id, upload.id)).get();
  if (!row || row.s3UploadId || row.received === 0) throw new UploadError(`The ${kind} file is empty`);
  const s3 = s3Storage();
  const from = stagingKey(row);
  const { mime, ext } = checkType(sniffMime(await headOf(from)), kind);
  const key = newKey(kind, ext);
  await s3.copy(from, key, mime);
  return { key, size: row.received, mime };
}

/** Throws away what a direct session left in the bucket: unfinished parts and the staged object. Never throws. */
export async function dropDirect(upload: Upload) {
  if (!upload.direct) return;
  const s3 = (() => {
    try {
      return s3Storage();
    } catch {
      return null;
    }
  })();
  if (!s3) return;
  const key = stagingKey(upload);
  const results = await Promise.allSettled([upload.s3UploadId ? s3.abortMultipart(key, upload.s3UploadId) : null, s3.remove(key)]);
  for (const r of results) if (r.status === "rejected") console.error(`[uploads] couldn't clean up ${key} in the bucket:`, r.reason);
}
