import crypto from "node:crypto";
import path from "node:path";
import { env } from "./env";
import { enqueue } from "./jobs";
import { sniffMime, UNSUPPORTED_IMAGE, UNSUPPORTED_VIDEO } from "./sniff";
import { createLocalDriver, isMediaKey } from "./storage/local";
import { createS3Driver, type FetchLike, type S3Driver } from "./storage/s3";

/**
 * Media storage: local disk under DATA_DIR/uploads (the default) or an
 * S3-compatible bucket (TEAM-05), picked by STORAGE_DRIVER. Uploads are
 * received and sniffed on disk, then put through the driver (D16), unless
 * S3_DIRECT_UPLOADS sends videos straight to the bucket (L9,
 * src/lib/direct-upload.ts). Keys are the same `videos|images/<uuid>.<ext>`
 * on every driver.
 */
export interface StoredObject {
  key: string;
  size: number;
}

export type MediaKind = "video" | "image";

const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const VIDEO_TYPES: Record<string, string> = {
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/ogg": "ogv",
};

export const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  [
    ...Object.entries(IMAGE_TYPES),
    ...Object.entries(VIDEO_TYPES),
    ["image/x-icon", "ico"],
    // VID-06: HLS playlists and their MPEG-TS segments.
    ["application/vnd.apple.mpegurl", "m3u8"],
    ["video/mp2t", "ts"],
  ].map(([m, e]) => [e, m]),
);

/** WALL-07 favicons: the largest file kept. Real ones are a few KB. */
export const MAX_FAVICON_BYTES = 512 * 1024;

/** Stores a wall favicon: PNG or ICO only (sniffed; never SVG), at most MAX_FAVICON_BYTES. */
export async function saveFavicon(file: File): Promise<StoredObject & { mime: string }> {
  if (file.size === 0) throw new UploadError("The image file is empty");
  if (file.size > MAX_FAVICON_BYTES) throw new UploadError("A favicon must be under 512 KB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes.subarray(0, 16));
  if (mime !== "image/png" && mime !== "image/x-icon") throw new UnsupportedMediaError("Choose a PNG or ICO file for the favicon.");
  const key = newKey("image", mime === "image/png" ? "png" : "ico");
  await storage().put(key, { bytes }, mime);
  return { key, size: bytes.byteLength, mime };
}

export { isVideoMime, sniffMime, UNSUPPORTED_VIDEO } from "./sniff";
export { hlsMasterOf, isMediaKey } from "./storage/local";

/** The Content-Type for a key, from its extension. */
export function mimeForKey(key: string) {
  return MIME_BY_EXT[key.slice(key.lastIndexOf(".") + 1)] ?? "application/octet-stream";
}

export class UploadError extends Error {}

/** The file isn't a type we accept (415 rather than 413). */
export class UnsupportedMediaError extends UploadError {}

/** The type and extension to store a sniffed file under, or an UnsupportedMediaError (never SVG). */
export function checkType(mime: string | null, kind: MediaKind) {
  const allowed = kind === "video" ? VIDEO_TYPES : IMAGE_TYPES;
  if (!mime || !(mime in allowed)) {
    throw new UnsupportedMediaError(
      kind === "video" ? UNSUPPORTED_VIDEO : UNSUPPORTED_IMAGE,
    );
  }
  return { mime, ext: allowed[mime] };
}

/** A fresh storage key such as `videos/<uuid>.mp4`. */
export function newKey(kind: MediaKind, ext: string) {
  return `${kind}s/${crypto.randomUUID()}.${ext}`;
}

/** Validates and stores an uploaded file, returning its storage key. */
export async function saveUpload(file: File, kind: MediaKind): Promise<StoredObject & { mime: string }> {
  const limit = kind === "video" ? env.maxVideoBytes : env.maxImageBytes;
  if (file.size === 0) throw new UploadError(`The ${kind} file is empty`);
  if (file.size > limit) {
    throw new UploadError(`The ${kind} file is larger than ${Math.round(limit / 1024 / 1024)} MB`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { mime, ext } = checkType(sniffMime(bytes.subarray(0, 16)), kind);
  const key = newKey(kind, ext);
  await storage().put(key, { bytes }, mime);
  return { key, size: bytes.byteLength, mime };
}

/** Stores a file that is already on disk (a finished upload or an import). */
export async function saveFile(
  source: string,
  mime: string | null,
  kind: MediaKind,
  opts: { move?: boolean } = {},
): Promise<StoredObject & { mime: string }> {
  const checked = checkType(mime, kind);
  const key = newKey(kind, checked.ext);
  const { size } = await storage().put(key, { path: source, move: opts.move }, checked.mime);
  return { key, size, mime: checked.mime };
}

/**
 * Maps a storage key to its path on local disk, refusing anything that
 * escapes the uploads dir. Only the local driver keeps files there: to read a
 * file on any driver, use storage().withLocalFile.
 */
export function resolveKey(key: string) {
  if (!isMediaKey(key)) throw new UploadError("Invalid media key");
  return path.join(env.uploadsDir, key);
}

export async function deleteObject(key: string | null | undefined) {
  if (!key) return;
  if (!isMediaKey(key)) throw new UploadError("Invalid media key");
  await storage().remove(key);
}

/** Retries removing a file whose delete failed; the handler is registered by registerStorageJobs. */
export const STORAGE_DELETE_JOB = "storage.delete";

/**
 * Removes files whose rows are already gone. A file that can't be removed now
 * (the bucket timed out or answered 5xx) is retried in the background, since
 * no row is left to find it again. Keys are never reused, so a retry can't
 * remove a file something uses. Never throws; returns how many went now.
 */
export async function removeFiles(keys: string[]): Promise<number> {
  const results = await Promise.allSettled(keys.map((k) => deleteObject(k)));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") return;
    console.error(`[storage] couldn't delete ${keys[i]}, will retry:`, r.reason);
    if (isMediaKey(keys[i])) enqueue(STORAGE_DELETE_JOB, { key: keys[i] }, { maxAttempts: 8 });
  });
  return results.filter((r) => r.status === "fulfilled").length;
}

export function mediaUrl(key: string | null | undefined, base = "") {
  return key ? `${base}/api/media/${key}` : null;
}

// ------------------------------------------------------------ drivers

/**
 * Where stored objects live, behind one interface so an S3-compatible bucket
 * can stand in for local disk. The drivers are in src/lib/storage/.
 */
export interface StorageDriver {
  name: "local" | "s3";
  /** Stores a file on disk (moved when `move`, else copied) or bytes under `key`. */
  put(key: string, src: { path: string; move?: boolean } | { bytes: Uint8Array }, mime: string): Promise<{ size: number }>;
  /** null when there's no such object. */
  stat(key: string): Promise<{ size: number; etag: string; mtimeMs: number } | null>;
  /** The object's bytes, or one range of them (`end` inclusive, as in an HTTP Range); null when it's missing. */
  read(key: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array> | null>;
  /** Missing objects are fine. */
  remove(key: string): Promise<void>;
  /**
   * Runs `fn` with a path to the object on local disk (ffmpeg, transcription,
   * zip export). Remote drivers download a temporary copy and delete it
   * afterwards. A missing object gives a path that doesn't exist.
   */
  withLocalFile<T>(key: string, fn: (path: string) => Promise<T>): Promise<T>;
}

/** DATA_DIR/uploads: today's files, and the source of the copy to S3. */
export const localDisk = createLocalDriver(() => env.uploadsDir);

let driver: StorageDriver | null = null;
let injectedFetch: FetchLike | undefined;

/** The bucket STORAGE_DRIVER=s3 points at, without the local fallback (the copy job HEADs it directly). */
export function s3Storage(): S3Driver {
  return createS3Driver({
    endpoint: env.s3Endpoint,
    region: env.s3Region,
    bucket: env.s3Bucket,
    accessKeyId: env.s3AccessKeyId,
    secretAccessKey: env.s3SecretAccessKey,
    forcePathStyle: env.s3ForcePathStyle,
    prefix: env.s3Prefix,
    tmpDir: () => env.tmpDir,
    fetch: injectedFetch,
  });
}

/**
 * The bucket, with files still on local disk served from there. Keys are
 * never reused, so a local copy always matches the bucket's. That way
 * switching an existing server to S3 breaks no media while "Copy local media
 * to S3" runs, and local copies kept after the copy keep working. Deletes
 * remove both copies.
 */
function withLocalFallback(s3: S3Driver): StorageDriver {
  return {
    name: "s3",
    put: (key, src, mime) => s3.put(key, src, mime),
    async stat(key) {
      return (await localDisk.stat(key)) ?? s3.stat(key);
    },
    async read(key, range) {
      return (await localDisk.read(key, range)) ?? s3.read(key, range);
    },
    async remove(key) {
      await Promise.all([s3.remove(key), localDisk.remove(key)]);
    },
    async withLocalFile(key, fn) {
      return (await localDisk.stat(key)) ? localDisk.withLocalFile(key, fn) : s3.withLocalFile(key, fn);
    },
  };
}

/** The driver STORAGE_DRIVER picks, made on first use (and again if the setting changes). */
export function storage(): StorageDriver {
  if (driver?.name !== env.storageDriver) {
    driver = env.storageDriver === "s3" ? withLocalFallback(s3Storage()) : localDisk;
  }
  return driver;
}

/**
 * Tests: forget the driver, so the next storage() reads the environment
 * again. `fetch` stands in for the network on S3 drivers made from then on.
 */
export function resetStorage(o: { fetch?: FetchLike } = {}) {
  driver = null;
  injectedFetch = o.fetch;
  lastStatus = null;
}

export type StorageStatus = {
  driver: "local" | "s3";
  /** null on local disk. */
  bucket: string | null;
  endpoint: string | null;
  prefix: string | null;
  ok: boolean;
  /** What's wrong, in words, when not ok. */
  error: string | null;
};

let lastStatus: { at: number; status: StorageStatus } | null = null;

/**
 * Whether media can be stored, for Settings and GET /api/admin/system. On S3
 * it asks the bucket (HeadBucket), so the answer is kept for a minute (ten
 * seconds after a failure) unless `fresh`. Never throws.
 */
export async function storageStatus(o: { fresh?: boolean } = {}): Promise<StorageStatus> {
  if (env.storageDriver === "local") return { driver: "local", bucket: null, endpoint: null, prefix: null, ok: true, error: null };
  const base = { driver: "s3" as const, bucket: env.s3Bucket || null, endpoint: env.s3Endpoint, prefix: env.s3Prefix };
  if (!o.fresh && lastStatus && Date.now() - lastStatus.at < (lastStatus.status.ok ? 60_000 : 10_000)) {
    const cached = lastStatus.status;
    if (cached.bucket === base.bucket && cached.endpoint === base.endpoint && cached.prefix === base.prefix) return cached;
  }
  let status: StorageStatus;
  try {
    await s3Storage().check();
    status = { ...base, ok: true, error: null };
  } catch (err) {
    status = { ...base, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  lastStatus = { at: Date.now(), status };
  return status;
}
