import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { StorageDriver } from "../storage";

/** Every stored object's key, on every driver: `videos|images/<uuid>.<ext>`. */
const KEY_RE = /^(videos|images)\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

export function isMediaKey(key: string) {
  return KEY_RE.test(key);
}

/** Moves a file, copying across filesystems (EXDEV) when a rename can't. */
export async function moveFile(from: string, to: string) {
  await fs.promises.rename(from, to).catch(async (err: NodeJS.ErrnoException) => {
    if (err.code !== "EXDEV") throw err;
    await fs.promises.copyFile(from, to);
    await fs.promises.rm(from, { force: true });
  });
}

/**
 * Files on local disk, under the directory `root()` returns (DATA_DIR/uploads
 * for the app; read on every call, so tests can move DATA_DIR). The key
 * pattern keeps every path inside it.
 */
export function createLocalDriver(root: () => string): StorageDriver & { name: "local" } {
  const file = (key: string) => {
    if (!isMediaKey(key)) throw new Error("Invalid media key");
    return path.join(root(), key);
  };
  const statFile = async (key: string) => {
    const s = await fs.promises.stat(file(key)).catch(() => null);
    return s?.isFile() ? s : null;
  };
  return {
    name: "local",
    async put(key, src, _mime) {
      const target = file(key);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      if ("bytes" in src) await fs.promises.writeFile(target, src.bytes);
      else if (src.move) await moveFile(src.path, target);
      else await fs.promises.copyFile(src.path, target);
      return { size: (await fs.promises.stat(target)).size };
    },
    async stat(key) {
      const s = await statFile(key);
      if (!s) return null;
      // The ETag /api/media has always sent, so browser caches stay valid.
      return { size: s.size, mtimeMs: s.mtimeMs, etag: `"${s.size.toString(36)}-${Math.floor(s.mtimeMs).toString(36)}"` };
    },
    async read(key, range) {
      if (!(await statFile(key))) return null;
      const stream = fs.createReadStream(file(key), range ? { start: range.start, end: range.end } : undefined);
      return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    },
    async remove(key) {
      await fs.promises.rm(file(key), { force: true });
    },
    async withLocalFile(key, fn) {
      // Already on disk: ffmpeg reads it in place.
      return fn(file(key));
    },
  };
}
