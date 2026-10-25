import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { env } from "./env";
import { sniffMime, UNSUPPORTED_IMAGE, UNSUPPORTED_VIDEO } from "./sniff";

/**
 * Media storage. The MVP stores files on local disk under DATA_DIR/uploads;
 * the interface is kept small so an S3-compatible driver can slot in later.
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
  [...Object.entries(IMAGE_TYPES), ...Object.entries(VIDEO_TYPES)].map(([m, e]) => [e, m]),
);

export { isVideoMime, sniffMime, UNSUPPORTED_VIDEO } from "./sniff";

export class UploadError extends Error {}

/** The file isn't a type we accept (415 rather than 413). */
export class UnsupportedMediaError extends UploadError {}

function checkType(mime: string | null, kind: MediaKind) {
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

/** Validates and writes an uploaded file, returning its storage key. */
export async function saveUpload(file: File, kind: MediaKind): Promise<StoredObject & { mime: string }> {
  const limit = kind === "video" ? env.maxVideoBytes : env.maxImageBytes;
  if (file.size === 0) throw new UploadError(`The ${kind} file is empty`);
  if (file.size > limit) {
    throw new UploadError(`The ${kind} file is larger than ${Math.round(limit / 1024 / 1024)} MB`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { mime, ext } = checkType(sniffMime(bytes.subarray(0, 16)), kind);
  const key = newKey(kind, ext);
  const target = resolveKey(key);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, bytes);
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
  const target = resolveKey(key);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  if (opts.move) {
    await fs.promises.rename(source, target).catch(async (err: NodeJS.ErrnoException) => {
      if (err.code !== "EXDEV") throw err;
      await fs.promises.copyFile(source, target);
      await fs.promises.rm(source, { force: true });
    });
  } else {
    await fs.promises.copyFile(source, target);
  }
  const { size } = await fs.promises.stat(target);
  return { key, size, mime: checked.mime };
}

/** Maps a storage key to a path, refusing anything that escapes the uploads dir. */
export function resolveKey(key: string) {
  if (!/^(videos|images)\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/.test(key)) {
    throw new UploadError("Invalid media key");
  }
  return path.join(env.uploadsDir, key);
}

export async function deleteObject(key: string | null | undefined) {
  if (!key) return;
  await fs.promises.rm(resolveKey(key), { force: true });
}

export function mediaUrl(key: string | null | undefined, base = "") {
  return key ? `${base}/api/media/${key}` : null;
}

// ------------------------------------------------------------ drivers

/**
 * Where stored objects live, behind one interface so an S3-compatible bucket
 * can stand in for local disk (TEAM-05, D16: uploads are still received and
 * sniffed on disk, then put here). Keys are the same `videos|images/<uuid>.<ext>`
 * on every driver.
 *
 * Contract published by WP1.1; WP1.6 moves the drivers to src/lib/storage/
 * and routes the helpers above through them. Until then nothing calls
 * storage(), and the helpers above keep writing to local disk directly.
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
   * zip export). Remote drivers download a temporary copy and delete it afterwards.
   */
  withLocalFile<T>(key: string, fn: (path: string) => Promise<T>): Promise<T>;
}

/** Today's behaviour: files under DATA_DIR/uploads. */
const localDriver: StorageDriver = {
  name: "local",
  async put(key, src, _mime) {
    const target = resolveKey(key);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    if ("bytes" in src) {
      await fs.promises.writeFile(target, src.bytes);
    } else if (src.move) {
      await fs.promises.rename(src.path, target).catch(async (err: NodeJS.ErrnoException) => {
        if (err.code !== "EXDEV") throw err;
        await fs.promises.copyFile(src.path, target);
        await fs.promises.rm(src.path, { force: true });
      });
    } else {
      await fs.promises.copyFile(src.path, target);
    }
    return { size: (await fs.promises.stat(target)).size };
  },
  async stat(key) {
    const s = await fs.promises.stat(resolveKey(key)).catch(() => null);
    if (!s?.isFile()) return null;
    // The same ETag /api/media sends today, so browser caches stay valid.
    return { size: s.size, mtimeMs: s.mtimeMs, etag: `"${s.size.toString(36)}-${Math.floor(s.mtimeMs).toString(36)}"` };
  },
  async read(key, range) {
    const file = resolveKey(key);
    if (!(await fs.promises.stat(file).catch(() => null))?.isFile()) return null;
    const stream = fs.createReadStream(file, range ? { start: range.start, end: range.end } : undefined);
    return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  },
  async remove(key) {
    await fs.promises.rm(resolveKey(key), { force: true });
  },
  async withLocalFile(key, fn) {
    return fn(resolveKey(key));
  },
};

let driver: StorageDriver | null = null;

/** The driver STORAGE_DRIVER picks, made on first use. */
export function storage(): StorageDriver {
  if (!driver) {
    if (env.storageDriver === "s3") throw new Error("not implemented: the S3 storage driver (STORAGE_DRIVER=s3)");
    driver = localDriver;
  }
  return driver;
}

/** Tests: forget the driver, so the next storage() reads the environment again. */
export function resetStorage() {
  driver = null;
}
