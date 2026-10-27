import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as media } from "@/app/api/media/[...key]/route";
import { GET as storageRoute } from "@/app/api/admin/system/storage/route";
import { env } from "@/lib/env";
import {
  deleteObject,
  isMediaKey,
  localDisk,
  mediaUrl,
  mimeForKey,
  newKey,
  resetStorage,
  resolveKey,
  saveFile,
  saveUpload,
  storage,
  storageStatus,
  UnsupportedMediaError,
  UploadError,
} from "@/lib/storage";
import { systemStatus } from "@/lib/system";
import { adminHeaders, params, PNG_BYTES, useTempDataDir, WEBM_BYTES } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;

beforeEach(() => {
  ctx = useTempDataDir();
  resetStorage();
});
afterEach(() => {
  delete process.env.STORAGE_DRIVER;
  delete process.env.MAX_IMAGE_MB;
  resetStorage();
  ctx.cleanup();
});

const onDisk = (key: string) => path.join(env.uploadsDir, key);
const readAll = async (stream: ReadableStream<Uint8Array> | null) => Buffer.from(await new Response(stream).arrayBuffer());
/** The ETag /api/media sent before storage drivers existed. */
const legacyEtag = (file: string) => {
  const s = fs.statSync(file);
  return `"${s.size.toString(36)}-${Math.floor(s.mtimeMs).toString(36)}"`;
};

function tmpFile(bytes: Uint8Array) {
  const file = path.join(ctx.dir, `src-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(file, bytes);
  return file;
}

describe("TEAM-05 local disk stays the default, with today's paths", () => {
  it("uses local disk unless STORAGE_DRIVER=s3", async () => {
    expect(storage().name).toBe("local");
    process.env.STORAGE_DRIVER = "Local";
    expect(storage().name).toBe("local");
    expect(await storageStatus()).toEqual({ driver: "local", bucket: null, endpoint: null, prefix: null, ok: true, error: null });
    expect((await systemStatus()).storage).toEqual({ driver: "local", bucket: null, ok: true, error: null });
  });

  it("saveUpload sniffs the file and writes it under DATA_DIR/uploads", async () => {
    const stored = await saveUpload(new File([PNG_BYTES], "photo.jpg", { type: "image/jpeg" }), "image");
    expect(stored).toMatchObject({ mime: "image/png", size: PNG_BYTES.byteLength });
    expect(stored.key).toMatch(/^images\/[0-9a-f-]{36}\.png$/);
    expect(resolveKey(stored.key)).toBe(onDisk(stored.key));
    expect(fs.readFileSync(onDisk(stored.key)).equals(Buffer.from(PNG_BYTES))).toBe(true);
  });

  it("saveUpload refuses empty, oversized and unsupported files", async () => {
    await expect(saveUpload(new File([], "a.png"), "image")).rejects.toThrow("The image file is empty");
    process.env.MAX_IMAGE_MB = "0.00001";
    await expect(saveUpload(new File([PNG_BYTES], "a.png"), "image")).rejects.toThrow(UploadError);
    delete process.env.MAX_IMAGE_MB;
    await expect(saveUpload(new File(["hello world, not a video"], "a.webm"), "video")).rejects.toThrow(UnsupportedMediaError);
    await expect(saveUpload(new File([WEBM_BYTES], "a.webm"), "image")).rejects.toThrow(UnsupportedMediaError);
    expect(fs.existsSync(env.uploadsDir)).toBe(false);
  });

  it("saveFile copies by default and moves when asked", async () => {
    const source = tmpFile(WEBM_BYTES);
    const copied = await saveFile(source, "video/webm", "video");
    expect(copied).toMatchObject({ mime: "video/webm", size: WEBM_BYTES.byteLength });
    expect(copied.key).toMatch(/^videos\/[0-9a-f-]{36}\.webm$/);
    expect(fs.existsSync(source)).toBe(true);
    const moved = await saveFile(source, "video/webm", "video", { move: true });
    expect(fs.existsSync(source)).toBe(false);
    expect(fs.readFileSync(onDisk(moved.key)).equals(fs.readFileSync(onDisk(copied.key)))).toBe(true);
    await expect(saveFile(tmpFile(PNG_BYTES), "image/svg+xml", "image")).rejects.toThrow(UnsupportedMediaError);
  });

  it("refuses keys that could leave the uploads dir, on every path in", async () => {
    for (const bad of ["../plaudit.db", "videos/../../plaudit.db", "videos/abc.webm", "other/" + newKey("video", "mp4").slice(7)]) {
      expect(isMediaKey(bad)).toBe(false);
      expect(() => resolveKey(bad)).toThrow(UploadError);
      await expect(deleteObject(bad)).rejects.toThrow(UploadError);
      await expect(storage().stat(bad)).rejects.toThrow("Invalid media key");
      await expect(storage().read(bad)).rejects.toThrow("Invalid media key");
    }
    expect(isMediaKey(newKey("image", "jpg"))).toBe(true);
  });

  it("stats, reads ranges, removes and lends files in place", async () => {
    const key = newKey("video", "webm");
    expect(await storage().put(key, { bytes: WEBM_BYTES }, "video/webm")).toEqual({ size: WEBM_BYTES.byteLength });
    const stat = await storage().stat(key);
    expect(stat).toMatchObject({ size: WEBM_BYTES.byteLength, etag: legacyEtag(onDisk(key)) });
    expect(await readAll(await storage().read(key))).toEqual(Buffer.from(WEBM_BYTES));
    expect(await readAll(await storage().read(key, { start: 2, end: 5 }))).toEqual(Buffer.from(WEBM_BYTES.subarray(2, 6)));
    // No temporary copy: ffmpeg reads the stored file itself.
    expect(await storage().withLocalFile(key, async (file) => file)).toBe(onDisk(key));

    await storage().remove(key);
    expect(fs.existsSync(onDisk(key))).toBe(false);
    expect(await storage().stat(key)).toBeNull();
    expect(await storage().read(key)).toBeNull();
    await storage().remove(key); // already gone is fine
    expect(await storage().withLocalFile(key, async (file) => fs.existsSync(file))).toBe(false);
  });

  it("deleteObject removes the file and ignores empty keys", async () => {
    const { key } = await saveFile(tmpFile(PNG_BYTES), "image/png", "image");
    await deleteObject(key);
    expect(fs.existsSync(onDisk(key))).toBe(false);
    await deleteObject(null);
    await deleteObject(undefined);
    await deleteObject("");
  });

  it("the media route sends the same ETag, ranges and types as before", async () => {
    const { key } = await saveFile(tmpFile(WEBM_BYTES), "video/webm", "video");
    const get = (headers: Record<string, string> = {}) =>
      media(new Request(`http://localhost/api/media/${key}`, { headers: { ...adminHeaders(), ...headers } }), params({ key: key.split("/") }));
    const full = await get();
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/webm");
    expect(full.headers.get("content-length")).toBe(String(WEBM_BYTES.byteLength));
    expect(Buffer.from(await full.arrayBuffer())).toEqual(Buffer.from(WEBM_BYTES));
    const part = await get({ range: "bytes=4-" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 4-15/${WEBM_BYTES.byteLength}`);
    expect(Buffer.from(await part.arrayBuffer())).toEqual(Buffer.from(WEBM_BYTES.subarray(4)));
    expect((await get({ range: "bytes=-3" })).headers.get("content-range")).toBe("bytes 13-15/16");
    expect((await get({ range: "bytes=99-" })).status).toBe(416);
    expect((await get({ range: "items=1-2" })).status).toBe(416);
    // The ETag a browser cached before the upgrade still matches.
    expect((await localDisk.stat(key))!.etag).toBe(legacyEtag(onDisk(key)));
    const missing = newKey("video", "webm");
    expect((await media(new Request(`http://localhost/api/media/${missing}`, { headers: adminHeaders() }), params({ key: missing.split("/") }))).status).toBe(404);
  });

  it("GET /api/admin/system/storage reports local disk and its file count", async () => {
    await saveFile(tmpFile(PNG_BYTES), "image/png", "image");
    await saveFile(tmpFile(WEBM_BYTES), "video/webm", "video");
    const res = await storageRoute(new Request("http://localhost/api/admin/system/storage", { headers: adminHeaders() }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      storage: { driver: "local", bucket: null, endpoint: null, prefix: null, ok: true, error: null, localFiles: 2 },
      migration: null,
    });
    expect((await storageRoute(new Request("http://localhost/api/admin/system/storage"))).status).toBe(401);
  });

  it("names media URLs and types as before", () => {
    expect(mediaUrl("images/x.png", "https://example.com")).toBe("https://example.com/api/media/images/x.png");
    expect(mediaUrl(null)).toBeNull();
    expect(mimeForKey("videos/a.mov")).toBe("video/quicktime");
    expect(mimeForKey("images/a.jpg")).toBe("image/jpeg");
    expect(mimeForKey("images/a.bin")).toBe("application/octet-stream");
  });
});
