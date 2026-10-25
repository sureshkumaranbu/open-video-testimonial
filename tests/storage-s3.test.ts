import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as media } from "@/app/api/media/[...key]/route";
import { POST as submit } from "@/app/api/projects/[slug]/testimonials/route";
import { GET as runRoute } from "@/app/api/admin/runs/[id]/route";
import { GET as storageGet, POST as storagePost } from "@/app/api/admin/system/storage/route";
import { createSessionToken, sessionCookieName } from "@/lib/auth";
import { env } from "@/lib/env";
import { runDueJobs } from "@/lib/jobs";
import { queueVideoProcessing, resetFfmpegCheck } from "@/lib/media";
import { getRunProgress } from "@/lib/runs";
import { localDisk, newKey, resetStorage, saveFile, storage, storageStatus } from "@/lib/storage";
import { MIGRATE_BATCH_FILES } from "@/lib/storage-migrate";
import { createS3Driver, S3Error, type S3Config } from "@/lib/storage/s3";
import { EMPTY_SHA256, presignUrl, sha256Hex, signRequest } from "@/lib/storage/sigv4";
import { systemStatus } from "@/lib/system";
import { createProject, createTestimonial, deleteTestimonial, getTestimonial, updateTestimonial } from "@/lib/testimonials";
import { appendChunk, claimUpload, createUpload } from "@/lib/uploads";
import { registerJobs } from "@/lib/worker";
import { createFakeS3, type FakeS3 } from "./fixtures/fake-s3";
import { adminHeaders, hasFfmpeg, params, PNG_BYTES, SAMPLE_WEBM, submissionForm, submitRequest, useTempDataDir, WEBM_BYTES } from "./helpers";

const KEYS = { accessKeyId: "PLAUDITTESTKEY", secretAccessKey: "plaudit-test-secret-0123456789" };
const BUCKET = "plaudit-media";
const REGION = "eu-west-2";
const MiB = 1024 * 1024;

let ctx: ReturnType<typeof useTempDataDir>;
let fake: FakeS3;

const readAll = async (stream: ReadableStream<Uint8Array> | null) => Buffer.from(await new Response(stream).arrayBuffer());
const random = (n: number) => crypto.randomBytes(n);

function tmpFile(bytes: Uint8Array) {
  const file = path.join(ctx.dir, `src-${crypto.randomUUID()}`);
  fs.writeFileSync(file, bytes);
  return file;
}

// ---------------------------------------------------------------- SigV4

describe("TEAM-05 SigV4 matches AWS's documented examples", () => {
  // From the S3 API reference, "Signature Calculations for the Authorization Header" and
  // "Authenticating Requests: Using Query Parameters" (examplebucket, 24 May 2013).
  const creds = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
  const scope = { region: "us-east-1", service: "s3" };
  const when = new Date(Date.UTC(2013, 4, 24));
  const sign = (method: string, url: string, headers: Record<string, string>, payloadHash = EMPTY_SHA256) =>
    signRequest({ method, url: new URL(url), headers, payloadHash }, creds, scope, when);

  it("GET Object with a Range", () => {
    const signed = sign("GET", "https://examplebucket.s3.amazonaws.com/test.txt", { range: "bytes=0-9" });
    expect(signed.canonicalRequest).toBe(
      [
        "GET",
        "/test.txt",
        "",
        "host:examplebucket.s3.amazonaws.com",
        "range:bytes=0-9",
        `x-amz-content-sha256:${EMPTY_SHA256}`,
        "x-amz-date:20130524T000000Z",
        "",
        "host;range;x-amz-content-sha256;x-amz-date",
        EMPTY_SHA256,
      ].join("\n"),
    );
    expect(signed.stringToSign).toBe(
      "AWS4-HMAC-SHA256\n20130524T000000Z\n20130524/us-east-1/s3/aws4_request\n7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972",
    );
    expect(signed.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    // fetch sets Host from the URL, so it isn't among the headers to send.
    expect(Object.keys(signed.headers).sort()).toEqual(["authorization", "range", "x-amz-content-sha256", "x-amz-date"]);
  });

  it("PUT Object, with a character in the key that must be encoded", () => {
    const signed = sign(
      "PUT",
      "https://examplebucket.s3.amazonaws.com/test$file.text",
      { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
      sha256Hex("Welcome to Amazon S3."),
    );
    expect(signed.canonicalRequest.split("\n")[1]).toBe("/test%24file.text");
    expect(signed.signature).toBe("98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });

  it("GET Bucket lifecycle and List Objects (query strings)", () => {
    expect(sign("GET", "https://examplebucket.s3.amazonaws.com/?lifecycle", {}).signature).toBe(
      "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543",
    );
    expect(sign("GET", "https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J", {}).signature).toBe(
      "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7",
    );
  });

  it("a presigned GET URL", () => {
    const url = presignUrl({ method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"), expiresSec: 86400 }, creds, scope, when);
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z" +
        "&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });
});

// ------------------------------------------------------------- the driver

describe("TEAM-05 S3 driver against the fake S3", () => {
  beforeEach(() => {
    ctx = useTempDataDir();
    fake = createFakeS3({ bucket: BUCKET, region: REGION, ...KEYS });
  });
  afterEach(() => ctx.cleanup());

  const driver = (o: Partial<S3Config> = {}) =>
    createS3Driver({
      endpoint: "http://s3.test:9000",
      region: REGION,
      bucket: BUCKET,
      ...KEYS,
      forcePathStyle: true,
      prefix: "plaudit/",
      tmpDir: () => env.tmpDir,
      fetch: fake.fetch,
      multipartThreshold: 6 * MiB,
      partSize: 5 * MiB,
      ...o,
    });

  it("puts bytes and files under the prefix, moving files when asked", async () => {
    const s3 = driver();
    const image = newKey("image", "png");
    expect(await s3.put(image, { bytes: PNG_BYTES }, "image/png")).toEqual({ size: PNG_BYTES.byteLength });
    expect(fake.objects.get(`plaudit/${image}`)).toMatchObject({ contentType: "image/png", body: Buffer.from(PNG_BYTES) });

    const video = newKey("video", "webm");
    const source = tmpFile(WEBM_BYTES);
    await s3.put(video, { path: source }, "video/webm");
    expect(fs.existsSync(source)).toBe(true);
    const moved = newKey("video", "webm");
    await s3.put(moved, { path: source, move: true }, "video/webm");
    expect(fs.existsSync(source)).toBe(false);
    expect(fake.objects.get(`plaudit/${moved}`)!.body).toEqual(Buffer.from(WEBM_BYTES));

    const puts = fake.requests.filter((r) => r.method === "PUT");
    expect(puts.map((r) => r.path)).toEqual([`/${BUCKET}/plaudit/${image}`, `/${BUCKET}/plaudit/${video}`, `/${BUCKET}/plaudit/${moved}`]);
    // Small bytes are hashed; files stream from disk unsigned (UNSIGNED-PAYLOAD).
    expect(puts[0].headers["x-amz-content-sha256"]).toBe(sha256Hex(PNG_BYTES));
    expect(puts[1].headers["x-amz-content-sha256"]).toBe("UNSIGNED-PAYLOAD");
    expect(puts[1].bodyBytes).toBe(WEBM_BYTES.byteLength);
    expect(puts[1].headers.authorization).toMatch(new RegExp(`Credential=${KEYS.accessKeyId}/\\d{8}/${REGION}/s3/aws4_request, SignedHeaders=content-type;host;`));
  });

  it("uploads large files in parts and puts them back together", async () => {
    const s3 = driver();
    const data = random(12 * MiB + 123);
    const key = newKey("video", "mp4");
    expect(await s3.put(key, { path: tmpFile(data) }, "video/mp4")).toEqual({ size: data.length });
    const stored = fake.objects.get(`plaudit/${key}`)!;
    expect(stored.body.equals(data)).toBe(true);
    expect(stored.contentType).toBe("video/mp4");
    expect(stored.etag).toMatch(/^"[0-9a-f]{32}-3"$/);
    expect(fake.writes().map((r) => `${r.method} ${r.query.replace(/uploadId=[0-9a-f]+/, "uploadId=…")}`)).toEqual([
      "POST uploads",
      "PUT partNumber=1&uploadId=…",
      "PUT partNumber=2&uploadId=…",
      "PUT partNumber=3&uploadId=…",
      "POST uploadId=…",
    ]);
    expect(fake.uploads.size).toBe(0);
    // The default threshold is 64 MB in 16 MB parts.
    expect((await driver({ multipartThreshold: undefined, partSize: undefined }).put(newKey("video", "mp4"), { path: tmpFile(data) }, "video/mp4")).size).toBe(data.length);
    expect(fake.writes().at(-1)!.query).toBe("");
  });

  it("aborts a multipart upload when a part fails, leaving nothing behind", async () => {
    const s3 = driver();
    fake.failNext((r) => r.method === "PUT" && r.query.startsWith("partNumber=2"));
    const key = newKey("video", "mp4");
    await expect(s3.put(key, { path: tmpFile(random(11 * MiB)) }, "video/mp4")).rejects.toThrow(/S3 upload failed with 500 InternalError/);
    expect(fake.writes().at(-1)).toMatchObject({ method: "DELETE" });
    expect(fake.writes().at(-1)!.query).toMatch(/^uploadId=/);
    expect(fake.uploads.size).toBe(0);
    expect(fake.objects.size).toBe(0);
  });

  it("reads whole objects and byte ranges, HEADs them, and says null when they're missing", async () => {
    const s3 = driver();
    const key = newKey("video", "webm");
    const data = random(1000);
    await s3.put(key, { bytes: data }, "video/webm");
    expect(await readAll(await s3.read(key))).toEqual(data);
    expect(await readAll(await s3.read(key, { start: 10, end: 19 }))).toEqual(data.subarray(10, 20));
    expect(fake.requests.at(-1)!.headers.range).toBe("bytes=10-19");

    const stat = await s3.stat(key);
    expect(stat).toMatchObject({ size: 1000, etag: fake.objects.get(`plaudit/${key}`)!.etag });
    expect(Math.abs(stat!.mtimeMs - Date.now())).toBeLessThan(5000);

    // A server that ignores Range still gives the caller just those bytes.
    fake.state.ignoreRange = true;
    expect(await readAll(await s3.read(key, { start: 990, end: 999 }))).toEqual(data.subarray(990));
    expect(await readAll(await s3.read(key, { start: 0, end: 0 }))).toEqual(data.subarray(0, 1));

    const missing = newKey("video", "webm");
    expect(await s3.stat(missing)).toBeNull();
    expect(await s3.read(missing)).toBeNull();
    await expect(s3.stat("../secret")).rejects.toThrow("Invalid media key");
  });

  it("deletes objects, and missing ones are fine", async () => {
    const s3 = driver();
    const key = newKey("image", "png");
    await s3.put(key, { bytes: PNG_BYTES }, "image/png");
    await s3.remove(key);
    expect(fake.objects.size).toBe(0);
    await s3.remove(key);
  });

  it("lends a temporary local copy for ffmpeg and always deletes it", async () => {
    const s3 = driver();
    const key = newKey("video", "webm");
    await s3.put(key, { bytes: WEBM_BYTES }, "video/webm");
    let seen = "";
    const size = await s3.withLocalFile(key, async (file) => {
      seen = file;
      expect(path.dirname(file)).toBe(env.tmpDir);
      expect(path.extname(file)).toBe(".webm");
      return fs.readFileSync(file).length;
    });
    expect(size).toBe(WEBM_BYTES.byteLength);
    expect(fs.existsSync(seen)).toBe(false);
    await expect(
      s3.withLocalFile(key, async (file) => {
        seen = file;
        throw new Error("ffmpeg fell over");
      }),
    ).rejects.toThrow("ffmpeg fell over");
    expect(fs.existsSync(seen)).toBe(false);
    // A missing object gives a path that doesn't exist, like a missing local file.
    expect(await s3.withLocalFile(newKey("video", "webm"), async (file) => fs.existsSync(file))).toBe(false);
  });

  it("puts the bucket in the host name unless path style is forced", async () => {
    const s3 = driver({ forcePathStyle: false, prefix: "" });
    const key = newKey("image", "png");
    await s3.put(key, { bytes: PNG_BYTES }, "image/png");
    expect(fake.requests.at(-1)).toMatchObject({ host: `${BUCKET}.s3.test:9000`, path: `/${key}` });
    expect(fake.objects.has(key)).toBe(true);
    await s3.check();
    expect(fake.requests.at(-1)).toMatchObject({ method: "HEAD", host: `${BUCKET}.s3.test:9000`, path: "/" });
    expect(s3.presignGet(key, 300)).toMatch(new RegExp(`^http://${BUCKET}\\.s3\\.test:9000/${key}\\?X-Amz-Algorithm=AWS4-HMAC-SHA256&.*X-Amz-Expires=300&.*X-Amz-Signature=[0-9a-f]{64}$`));
  });

  it("explains a wrong secret, a missing bucket and missing settings", async () => {
    const wrong = driver({ secretAccessKey: "not-the-secret" });
    const err = await wrong.put(newKey("image", "png"), { bytes: PNG_BYTES }, "image/png").catch((e) => e);
    expect(err).toBeInstanceOf(S3Error);
    expect(err).toMatchObject({ status: 403, code: "SignatureDoesNotMatch" });
    await expect(wrong.check()).rejects.toThrow(/403.*access denied/);
    await expect(driver({ bucket: "nope" }).check()).rejects.toThrow(/404.*no such bucket/);
    expect(() => driver({ bucket: "" })).toThrow("S3 storage needs S3_BUCKET");
    expect(() => driver({ secretAccessKey: "" })).toThrow("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
    expect(() => driver({ endpoint: "ftp://example.com" })).toThrow("https:// or http://");
  });
});

// ------------------------------------------------- STORAGE_DRIVER=s3, end to end

const S3_ENV = {
  STORAGE_DRIVER: "s3",
  S3_ENDPOINT: "http://minio.test:9000",
  S3_REGION: REGION,
  S3_BUCKET: BUCKET,
  S3_ACCESS_KEY_ID: KEYS.accessKeyId,
  S3_SECRET_ACCESS_KEY: KEYS.secretAccessKey,
  S3_FORCE_PATH_STYLE: "true",
  S3_PREFIX: "/media/",
};

describe("TEAM-05 STORAGE_DRIVER=s3", () => {
  let projectId: string;

  beforeEach(() => {
    ctx = useTempDataDir();
    fake = createFakeS3({ bucket: BUCKET, region: REGION, ...KEYS });
    Object.assign(process.env, S3_ENV);
    resetStorage({ fetch: fake.fetch });
    resetFfmpegCheck();
    registerJobs();
    projectId = createProject({ name: "Acme", slug: "acme" }).id;
  });
  afterEach(() => {
    for (const k of [...Object.keys(S3_ENV), "ADMIN_EMAILS", "TRANSCRIBE_PROVIDER", "TRANSCRIBE_COMMAND"]) delete process.env[k];
    resetStorage();
    resetFfmpegCheck();
    ctx.cleanup();
  });

  const inBucket = (key: string | null | undefined) => (key ? fake.objects.get(`media/${key}`) : undefined);
  const onDisk = (key: string) => fs.existsSync(path.join(env.uploadsDir, key));
  const get = (key: string, headers: Record<string, string> = {}) =>
    media(new Request(`http://localhost/api/media/${key}`, { headers }), params({ key: key.split("/") }));

  it("stores submitted videos and photos in the bucket, not on disk", async () => {
    expect(storage().name).toBe("s3");
    const res = await submit(
      submitRequest(
        "acme",
        submissionForm({
          name: "Ada",
          consent: "on",
          video: new File([WEBM_BYTES], "clip.webm", { type: "video/webm" }),
          avatar: new File([PNG_BYTES], "me.png", { type: "image/png" }),
        }),
      ),
      params({ slug: "acme" }),
    );
    expect(res.status).toBe(201);
    const t = getTestimonial((await res.json()).id)!;
    expect(inBucket(t.videoKey)).toMatchObject({ contentType: "video/webm", body: Buffer.from(WEBM_BYTES) });
    expect(inBucket(t.avatarKey)).toMatchObject({ contentType: "image/png" });
    expect(onDisk(t.videoKey!) || onDisk(t.avatarKey!)).toBe(false);
  });

  it("puts finished resumable uploads in the bucket after sniffing them on disk", async () => {
    const { upload } = createUpload("video", { projectId, maxBytes: 1024 });
    await appendChunk(upload, 0, WEBM_BYTES);
    const stored = await claimUpload({ ...upload, received: WEBM_BYTES.byteLength }, "video");
    expect(inBucket(stored.key)!.body).toEqual(Buffer.from(WEBM_BYTES));
    expect(fs.readdirSync(env.tmpDir)).toEqual([]);
  });

  it("serves media from the bucket with Range, ETag and 304, and the same privacy rules", async () => {
    const data = random(4096);
    const { key } = await saveFile(tmpFile(data), "video/webm", "video");
    const t = createTestimonial(projectId, { name: "Ada", videoKey: key, videoMime: "video/webm" });
    expect((await get(key)).status).toBe(404); // pending: private
    expect((await get(key, adminHeaders())).headers.get("cache-control")).toBe("private, no-store");

    updateTestimonial(t.id, { status: "approved" });
    const full = await get(key);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/webm");
    expect(full.headers.get("content-length")).toBe("4096");
    expect(full.headers.get("cache-control")).toBe("public, no-cache");
    const etag = full.headers.get("etag")!;
    expect(etag).toBe(inBucket(key)!.etag);
    expect(Buffer.from(await full.arrayBuffer()).equals(data)).toBe(true);

    expect((await get(key, { "if-none-match": etag })).status).toBe(304);
    const part = await get(key, { range: "bytes=100-199" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 100-199/4096");
    expect(Buffer.from(await part.arrayBuffer()).equals(data.subarray(100, 200))).toBe(true);
    expect(fake.requests.at(-1)!.headers.range).toBe("bytes=100-199");
    const tail = await get(key, { range: "bytes=-10" });
    expect(Buffer.from(await tail.arrayBuffer()).equals(data.subarray(4086))).toBe(true);
    expect((await get(key, { range: "bytes=5000-" })).status).toBe(416);

    updateTestimonial(t.id, { status: "rejected" });
    expect((await get(key)).status).toBe(404);
  });

  it("keeps serving files still on local disk until they're copied", async () => {
    const key = newKey("image", "png");
    await localDisk.put(key, { bytes: PNG_BYTES }, "image/png");
    const res = await get(key, adminHeaders());
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from(PNG_BYTES));
    expect(fake.requests).toEqual([]);
  });

  it("deleting a testimonial removes its objects from the bucket and any local copy", async () => {
    const video = await saveFile(tmpFile(WEBM_BYTES), "video/webm", "video");
    const avatar = newKey("image", "png");
    await localDisk.put(avatar, { bytes: PNG_BYTES }, "image/png");
    const t = createTestimonial(projectId, { name: "Ada", videoKey: video.key, videoMime: video.mime, avatarKey: avatar });
    await deleteTestimonial(t.id);
    expect(inBucket(video.key)).toBeUndefined();
    expect(onDisk(avatar)).toBe(false);
  });

  it("answers 503, not 500, when the bucket can't be reached", async () => {
    const { key } = await saveFile(tmpFile(WEBM_BYTES), "video/webm", "video");
    fake.failNext((r) => r.method === "HEAD", 503);
    const res = await get(key, adminHeaders());
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reports the bucket in Settings, and why it isn't working", async () => {
    expect((await systemStatus()).storage).toEqual({ driver: "s3", bucket: BUCKET, ok: true, error: null });
    process.env.S3_BUCKET = "missing-bucket";
    const status = await storageStatus({ fresh: true });
    expect(status).toMatchObject({ driver: "s3", bucket: "missing-bucket", endpoint: "http://minio.test:9000", prefix: "media/", ok: false });
    expect(status.error).toMatch(/no such bucket/);
    process.env.S3_SECRET_ACCESS_KEY = "";
    expect((await storageStatus({ fresh: true })).error).toBe("S3 storage needs S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
  });

  describe.skipIf(!hasFfmpeg())("video processing and transcripts (needs ffmpeg)", () => {
    it("converts a video from the bucket through a temporary copy and puts the MP4 and poster there", async () => {
      process.env.TRANSCRIBE_PROVIDER = "command";
      process.env.TRANSCRIBE_COMMAND = `"${process.execPath}" ${path.resolve(__dirname, "../e2e/fixtures/fake-whisper.mjs")} {input} {output}`;
      const stored = await saveFile(SAMPLE_WEBM, "video/webm", "video");
      const t = createTestimonial(projectId, { name: "Ada", videoKey: stored.key, videoMime: stored.mime });
      updateTestimonial(t.id, { status: "approved" });
      await queueVideoProcessing(t.id);
      await runDueJobs();

      const done = getTestimonial(t.id)!;
      expect(done).toMatchObject({ mediaStatus: "ready", videoMime: "video/mp4", videoOriginalKey: stored.key, transcriptStatus: "ready" });
      expect(done.transcript).toMatch(/stand-in transcript/);
      expect(inBucket(done.videoKey)).toMatchObject({ contentType: "video/mp4" });
      expect(inBucket(done.posterKey)).toMatchObject({ contentType: "image/jpeg" });
      expect(inBucket(stored.key)).toBeDefined(); // the original is kept
      // Nothing left behind on local disk: no uploads, no temporary copies.
      expect(fs.existsSync(env.uploadsDir)).toBe(false);
      expect(fs.readdirSync(env.tmpDir)).toEqual([]);

      const res = await get(done.videoKey!, { range: "bytes=0-11" });
      expect(res.status).toBe(206);
      expect(Buffer.from(await res.arrayBuffer()).subarray(4, 8).toString("latin1")).toBe("ftyp");
    });

    it("cleans up when processing fails", async () => {
      const junk = tmpFile(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(4096, 7)]));
      const stored = await saveFile(junk, "video/webm", "video");
      const t = createTestimonial(projectId, { name: "Ada", videoKey: stored.key, videoMime: stored.mime });
      await queueVideoProcessing(t.id);
      await runDueJobs({ now: () => new Date(Date.now() + 24 * 60 * 60 * 1000) });
      await runDueJobs({ now: () => new Date(Date.now() + 48 * 60 * 60 * 1000) });
      expect(getTestimonial(t.id)!.mediaStatus).toBe("failed");
      expect([...fake.objects.keys()]).toEqual([`media/${stored.key}`]);
      expect(fs.readdirSync(env.tmpDir)).toEqual([]);
    });
  });

  // ------------------------------------------------- Copy local media to S3

  describe("Copy local media to S3", () => {
    const post = (body: unknown, headers: Record<string, string> = adminHeaders()) =>
      storagePost(new Request("http://localhost/api/admin/system/storage", { method: "POST", body: JSON.stringify(body), headers }));
    const status = async () => (await storageGet(new Request("http://localhost/api/admin/system/storage", { headers: adminHeaders() }))).json();
    const localFiles = async (n: number) => {
      const keys: string[] = [];
      for (let i = 0; i < n; i++) {
        const key = newKey(i % 2 ? "image" : "video", i % 2 ? "png" : "webm");
        await localDisk.put(key, { bytes: i % 2 ? PNG_BYTES : WEBM_BYTES }, "");
        keys.push(key);
      }
      return keys;
    };

    it("copies every local file once; running it again copies nothing", async () => {
      const keys = await localFiles(3);
      expect((await status()).storage).toMatchObject({ driver: "s3", ok: true, localFiles: 3 });

      const res = await post({});
      expect(res.status).toBe(201);
      const { run } = await res.json();
      expect(run).toMatchObject({ kind: "storage-migrate", subject: "local->s3", status: "queued", finished: false });
      await runDueJobs();
      expect(getRunProgress(run.id)).toMatchObject({ status: "done", total: 3, done: 3, duplicates: 0, failed: 0, percent: 100, finished: true });
      for (const key of keys) {
        expect(inBucket(key)!.body.length).toBeGreaterThan(0);
        expect(onDisk(key)).toBe(true); // local copies are kept unless asked
      }
      expect(inBucket(keys[0])!.contentType).toBe("video/webm");
      const puts = fake.requests.filter((r) => r.method === "PUT").length;

      const again = (await (await post({})).json()).run;
      await runDueJobs();
      expect(getRunProgress(again.id)).toMatchObject({ status: "done", total: 3, done: 0, duplicates: 3 });
      expect(fake.requests.filter((r) => r.method === "PUT").length).toBe(puts);
      expect((await status()).migration).toMatchObject({ id: again.id, status: "done" });

      // The dashboard polls the run like any other.
      const polled = await runRoute(new Request(`http://localhost/api/admin/runs/${again.id}`, { headers: adminHeaders() }), params({ id: again.id }));
      expect((await polled.json()).run).toMatchObject({ id: again.id, duplicates: 3 });
    });

    it("works in batches that re-queue themselves, and can delete the local copies", async () => {
      const keys = await localFiles(MIGRATE_BATCH_FILES + 5);
      const { run } = await (await post({ deleteLocal: true })).json();
      expect(await runDueJobs({ limit: 1 })).toBe(1);
      expect(getRunProgress(run.id)).toMatchObject({ status: "running", done: MIGRATE_BATCH_FILES, total: MIGRATE_BATCH_FILES + 5 });
      await runDueJobs();
      expect(getRunProgress(run.id)).toMatchObject({ status: "done", done: MIGRATE_BATCH_FILES + 5, failed: 0 });
      for (const key of keys) {
        expect(inBucket(key)).toBeDefined();
        expect(onDisk(key)).toBe(false);
      }
      // Served from the bucket now.
      expect((await get(keys[0], adminHeaders())).status).toBe(200);
    });

    it("records files that fail and carries on", async () => {
      const keys = await localFiles(3);
      fake.failNext((r) => r.method === "PUT" && r.path.endsWith(keys.slice().sort()[1]));
      const { run } = await (await post({})).json();
      await runDueJobs();
      const done = getRunProgress(run.id)!;
      expect(done).toMatchObject({ status: "done", done: 2, failed: 1, errorCount: 1 });
      expect(done.errors[0]).toMatchObject({ item: keys.slice().sort()[1] });
      expect(done.errors[0].message).toMatch(/500 InternalError/);
    });

    it("stops with the reason when the bucket can't be reached", async () => {
      await localFiles(1);
      const { run } = await (await post({})).json();
      process.env.S3_SECRET_ACCESS_KEY = "changed-since";
      await runDueJobs();
      const failed = getRunProgress(run.id)!;
      expect(failed).toMatchObject({ status: "failed", finished: true, done: 0 });
      expect(failed.errors[0].message).toMatch(/The bucket can't be reached: .*403/);
    });

    it("is for the owner only, needs STORAGE_DRIVER=s3, and runs one at a time", async () => {
      await localFiles(1);
      process.env.ADMIN_EMAILS = "helper@example.com";
      const helper = { cookie: `${sessionCookieName()}=${createSessionToken("helper@example.com")}`, "sec-fetch-site": "same-origin" };
      expect((await post({}, helper)).status).toBe(403);
      expect((await storageGet(new Request("http://localhost/api/admin/system/storage", { headers: helper }))).status).toBe(200);
      expect((await post({}, { cookie: adminHeaders().cookie, "sec-fetch-site": "cross-site" })).status).toBe(403);
      expect((await post({ deleteLocal: "yes" })).status).toBe(400);

      expect((await post({})).status).toBe(201);
      const busy = await post({});
      expect(busy.status).toBe(409);
      expect((await busy.json()).error).toBe("A copy is already running.");
      await runDueJobs();

      process.env.STORAGE_DRIVER = "local";
      const local = await post({});
      expect(local.status).toBe(409);
      expect((await local.json()).error).toMatch(/Set STORAGE_DRIVER=s3/);

      process.env.STORAGE_DRIVER = "s3";
      process.env.S3_BUCKET = "missing-bucket";
      const unreachable = await post({});
      expect(unreachable.status).toBe(409);
      expect((await unreachable.json()).error).toMatch(/The bucket can't be reached: .*no such bucket/);
    });
  });
});
