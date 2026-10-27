import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as media } from "@/app/api/media/[...key]/route";
import { POST as submit } from "@/app/api/projects/[slug]/testimonials/route";
import { env } from "@/lib/env";
import { newKey, resetStorage, saveFile, storage, storageStatus } from "@/lib/storage";
import { createS3Driver, S3Error, type S3Config } from "@/lib/storage/s3";
import { createProject, createTestimonial, deleteTestimonial, getTestimonial, updateTestimonial } from "@/lib/testimonials";
import { registerJobs } from "@/lib/worker";
import { params, PNG_BYTES, submissionForm, submitRequest, useTempDataDir, WEBM_BYTES } from "./helpers";

/**
 * TEAM-05 against a real S3-compatible server (MinIO in CI; see
 * .github/workflows/ci.yml and docker-compose.s3.yml). tests/storage-s3.test.ts
 * covers the same driver against an in-process fake, which can also inject
 * failures; this file checks that real S3 agrees with it: signing, multipart,
 * ranges, deletes, presigned URLs and the app's media route. Skipped unless
 * S3_TEST_ENDPOINT is set, e.g.
 *
 *   S3_TEST_ENDPOINT=http://127.0.0.1:9000 S3_TEST_BUCKET=plaudit \
 *   S3_TEST_ACCESS_KEY_ID=plaudit S3_TEST_SECRET_ACCESS_KEY=plaudit-minio-secret npx vitest run tests/storage-minio.test.ts
 *
 * Every run writes under its own prefix and removes what it wrote.
 */

const ENDPOINT = process.env.S3_TEST_ENDPOINT ?? "";
const REAL: Omit<S3Config, "tmpDir"> = {
  endpoint: ENDPOINT,
  region: process.env.S3_TEST_REGION || "us-east-1",
  bucket: process.env.S3_TEST_BUCKET || "plaudit",
  accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID || "",
  secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY || "",
  forcePathStyle: true,
  prefix: "",
};
const MiB = 1024 * 1024;

const readAll = async (stream: ReadableStream<Uint8Array> | null) => Buffer.from(await new Response(stream).arrayBuffer());

describe.skipIf(!ENDPOINT)("TEAM-05 S3 driver against a real S3 server (MinIO)", () => {
  let ctx: ReturnType<typeof useTempDataDir>;
  let prefix: string;
  const written: string[] = [];

  beforeEach(() => {
    ctx = useTempDataDir();
    prefix = `test-${crypto.randomUUID()}/`;
  });
  afterEach(async () => {
    const s3 = driver();
    await Promise.all(written.splice(0).map((k) => s3.remove(k).catch(() => undefined)));
    ctx.cleanup();
  });

  const driver = (o: Partial<S3Config> = {}) =>
    createS3Driver({ ...REAL, prefix, tmpDir: () => env.tmpDir, multipartThreshold: 6 * MiB, partSize: 5 * MiB, ...o });
  const key = (kind: "image" | "video", ext: string) => {
    const k = newKey(kind, ext);
    written.push(k);
    return k;
  };
  const tmpFile = (bytes: Uint8Array) => {
    const file = path.join(ctx.dir, `src-${crypto.randomUUID()}`);
    fs.writeFileSync(file, bytes);
    return file;
  };

  it("checks the bucket, puts bytes and files, and reads them back whole, in ranges and by HEAD", async () => {
    const s3 = driver();
    await s3.check();
    const image = key("image", "png");
    expect(await s3.put(image, { bytes: PNG_BYTES }, "image/png")).toEqual({ size: PNG_BYTES.byteLength });
    expect(await readAll(await s3.read(image))).toEqual(Buffer.from(PNG_BYTES));

    const data = crypto.randomBytes(1000);
    const video = key("video", "webm");
    const source = tmpFile(data);
    await s3.put(video, { path: source, move: true }, "video/webm");
    expect(fs.existsSync(source)).toBe(false);
    expect(await readAll(await s3.read(video, { start: 10, end: 19 }))).toEqual(data.subarray(10, 20));
    const stat = await s3.stat(video);
    expect(stat).toMatchObject({ size: 1000 });
    expect(stat!.etag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(await s3.stat(newKey("video", "webm"))).toBeNull();
    expect(await s3.read(newKey("video", "webm"))).toBeNull();
  });

  it("uploads a large file in parts that S3 puts back together", async () => {
    const s3 = driver();
    const data = crypto.randomBytes(12 * MiB + 123);
    const k = key("video", "mp4");
    expect(await s3.put(k, { path: tmpFile(data) }, "video/mp4")).toEqual({ size: data.length });
    expect((await s3.stat(k))!.etag).toMatch(/-3"$/);
    expect((await readAll(await s3.read(k))).equals(data)).toBe(true);
  });

  it("deletes (a missing object is fine), lends a local copy, and presigns a URL S3 accepts", async () => {
    const s3 = driver();
    const k = key("video", "webm");
    await s3.put(k, { bytes: WEBM_BYTES }, "video/webm");
    let seen = "";
    expect(await s3.withLocalFile(k, async (file) => ((seen = file), fs.readFileSync(file).length))).toBe(WEBM_BYTES.byteLength);
    expect(fs.existsSync(seen)).toBe(false);
    const signed = await fetch(s3.presignGet(k, 60));
    expect(signed.status).toBe(200);
    expect(Buffer.from(await signed.arrayBuffer())).toEqual(Buffer.from(WEBM_BYTES));
    await s3.remove(k);
    expect(await s3.stat(k)).toBeNull();
    await s3.remove(k);
  });

  it("explains a wrong secret and a missing bucket", async () => {
    const err = await driver({ secretAccessKey: "not-the-secret" })
      .put(key("image", "png"), { bytes: PNG_BYTES }, "image/png")
      .catch((e) => e);
    expect(err).toBeInstanceOf(S3Error);
    expect(err).toMatchObject({ status: 403, code: "SignatureDoesNotMatch" });
    await expect(driver({ bucket: `missing-${crypto.randomUUID().slice(0, 8)}` }).check()).rejects.toThrow(/404.*no such bucket/);
  });
});

describe.skipIf(!ENDPOINT)("TEAM-05 STORAGE_DRIVER=s3 against a real S3 server (MinIO)", () => {
  let ctx: ReturnType<typeof useTempDataDir>;
  let projectId: string;
  const ENV = {
    STORAGE_DRIVER: "s3",
    S3_ENDPOINT: ENDPOINT,
    S3_REGION: REAL.region,
    S3_BUCKET: REAL.bucket,
    S3_ACCESS_KEY_ID: REAL.accessKeyId,
    S3_SECRET_ACCESS_KEY: REAL.secretAccessKey,
    S3_FORCE_PATH_STYLE: "true",
    S3_PREFIX: `app-${crypto.randomUUID()}`,
  };

  beforeEach(() => {
    ctx = useTempDataDir();
    Object.assign(process.env, ENV);
    resetStorage();
    registerJobs();
    projectId = createProject({ name: "Acme", slug: "acme" }).id;
  });
  afterEach(() => {
    for (const k of Object.keys(ENV)) delete process.env[k];
    resetStorage();
    ctx.cleanup();
  });

  const get = (k: string, headers: Record<string, string> = {}) =>
    media(new Request(`http://localhost/api/media/${k}`, { headers }), params({ key: k.split("/") }));

  it("stores a submission's photo in the bucket, serves it once approved, and deletes it with the testimonial", async () => {
    expect(storage().name).toBe("s3");
    expect(await storageStatus()).toMatchObject({ driver: "s3", ok: true, error: null });
    const res = await submit(
      submitRequest("acme", submissionForm({ name: "Ada", consent: "on", text: "Lovely", avatar: new File([PNG_BYTES], "me.png", { type: "image/png" }) })),
      params({ slug: "acme" }),
    );
    expect(res.status).toBe(201);
    const t = getTestimonial((await res.json()).id)!;
    expect(fs.existsSync(path.join(env.uploadsDir, t.avatarKey!))).toBe(false);
    expect((await get(t.avatarKey!)).status).toBe(404);
    updateTestimonial(t.id, { status: "approved" });
    const shown = await get(t.avatarKey!);
    expect(shown.status).toBe(200);
    expect(Buffer.from(await shown.arrayBuffer())).toEqual(Buffer.from(PNG_BYTES));
    await deleteTestimonial(t.id);
    expect(await storage().stat(t.avatarKey!)).toBeNull();
  });

  it("answers byte ranges and conditional requests from the bucket", async () => {
    const data = crypto.randomBytes(4096);
    const file = path.join(ctx.dir, "clip.webm");
    fs.writeFileSync(file, data);
    const { key } = await saveFile(file, "video/webm", "video");
    const t = createTestimonial(projectId, { name: "Bo", videoKey: key, videoMime: "video/webm" });
    updateTestimonial(t.id, { status: "approved" });
    const full = await get(key);
    expect(full.headers.get("content-length")).toBe("4096");
    expect((await get(key, { "if-none-match": full.headers.get("etag")! })).status).toBe(304);
    const part = await get(key, { range: "bytes=100-199" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 100-199/4096");
    expect(Buffer.from(await part.arrayBuffer()).equals(data.subarray(100, 200))).toBe(true);
    await deleteTestimonial(t.id);
    expect(await storage().stat(key)).toBeNull();
  });
});
