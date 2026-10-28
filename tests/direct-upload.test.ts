import crypto from "node:crypto";
import fs from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as startAdminUpload } from "@/app/api/admin/uploads/route";
import { POST as startUpload } from "@/app/api/projects/[slug]/uploads/route";
import { POST as submit } from "@/app/api/projects/[slug]/testimonials/route";
import { POST as completeRoute } from "@/app/api/uploads/[id]/complete/route";
import { POST as partsRoute } from "@/app/api/uploads/[id]/parts/route";
import { DELETE, GET, PUT } from "@/app/api/uploads/[id]/route";
import { getDb, schema } from "@/db";
import { publicCsp } from "@/lib/csp";
import { DIRECT_PART_BYTES, directUploadOrigin } from "@/lib/direct-upload";
import { env } from "@/lib/env";
import { ResumableUpload } from "@/lib/resumable-upload";
import { resetStorage } from "@/lib/storage";
import { createS3Driver } from "@/lib/storage/s3";
import { presignUrl } from "@/lib/storage/sigv4";
import { createProject, getTestimonial } from "@/lib/testimonials";
import { cleanupExpiredUploads } from "@/lib/uploads";
import { proxy } from "@/proxy";
import { createFakeS3, type FakeS3 } from "./fixtures/fake-s3";
import { adminHeaders, params, PNG_BYTES, submissionForm, submitRequest, useTempDataDir, WEBM_BYTES } from "./helpers";

const KEYS = { accessKeyId: "PLAUDITTESTKEY", secretAccessKey: "plaudit-test-secret-0123456789" };
const BUCKET = "plaudit-media";
const REGION = "eu-west-2";
const ENDPOINT = "http://minio.test:9000";
const S3_ENV = {
  STORAGE_DRIVER: "s3",
  S3_ENDPOINT: ENDPOINT,
  S3_REGION: REGION,
  S3_BUCKET: BUCKET,
  S3_ACCESS_KEY_ID: KEYS.accessKeyId,
  S3_SECRET_ACCESS_KEY: KEYS.secretAccessKey,
  S3_FORCE_PATH_STYLE: "true",
  S3_PREFIX: "media",
  S3_DIRECT_UPLOADS: "true",
};
const IP = { "x-forwarded-for": "198.51.100.30" };

let ctx: ReturnType<typeof useTempDataDir>;
let fake: FakeS3;

beforeEach(() => {
  ctx = useTempDataDir();
  fake = createFakeS3({ bucket: BUCKET, region: REGION, ...KEYS });
  Object.assign(process.env, S3_ENV);
  resetStorage({ fetch: fake.fetch });
  createProject({ name: "Acme", slug: "acme" });
});
afterEach(() => {
  for (const k of Object.keys(S3_ENV)) delete process.env[k];
  resetStorage();
  ctx.cleanup();
});

/** A video of `size` bytes that sniffs as WebM. */
const webm = (size: number) => Buffer.concat([Buffer.from(WEBM_BYTES), crypto.randomBytes(Math.max(size - WEBM_BYTES.length, 0))]);
const staged = () => [...fake.objects.keys()].filter((k) => k.startsWith("media/tmp/"));
const sessions = () => getDb().select().from(schema.uploads).all();

async function start(body: Record<string, unknown> = { direct: true, contentType: "video/webm" }) {
  const res = await startUpload(
    new Request("http://localhost/api/projects/acme/uploads", { method: "POST", body: JSON.stringify(body), headers: { ...IP, "content-type": "application/json" } }),
    params({ slug: "acme" }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; token: string; direct?: { partSize: number } };
}

const parts = (id: string, token: string, body: unknown) =>
  partsRoute(new Request(`http://localhost/api/uploads/${id}/parts`, { method: "POST", body: JSON.stringify(body), headers: { ...IP, "x-upload-token": token } }), params({ id }));
const complete = (id: string, token: string) =>
  completeRoute(new Request(`http://localhost/api/uploads/${id}/complete`, { method: "POST", headers: { ...IP, "x-upload-token": token } }), params({ id }));

/** Presigns part n and PUTs `bytes` to the bucket as a browser would, with the headers it was given. */
async function putPart(id: string, token: string, n: number, bytes: Uint8Array, o: { type?: string; size?: number } = {}) {
  const presigned = await parts(id, token, { partNumber: n, size: o.size ?? bytes.byteLength });
  expect(presigned.status, await presigned.clone().text()).toBe(200);
  const { url, headers } = await presigned.json();
  return fake.fetch(url, { method: "PUT", headers: o.type ? { ...headers, "Content-Type": o.type } : headers, body: new Uint8Array(bytes) });
}

/**
 * The browser's fetch: the app's own paths go to the route handlers, the
 * bucket's to the fake S3, unless `bucket` says otherwise (a CORS refusal).
 */
function browserFetch(log: string[], bucket?: (url: URL) => Promise<Response>) {
  return async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, "http://localhost");
    log.push(`${init.method ?? "GET"} ${url.host === "localhost" ? url.pathname : `bucket ${url.searchParams.has("partNumber") ? "part" : url.pathname}`}`);
    if (url.host !== "localhost") return bucket ? bucket(url) : fake.fetch(url.toString(), init);
    const req = new Request(url, { ...init, headers: { ...IP, ...(init.headers as Record<string, string>) } });
    if (url.pathname === "/api/projects/acme/uploads") return startUpload(req, params({ slug: "acme" }));
    const [, id, action] = /^\/api\/uploads\/([^/]+)(?:\/(parts|complete))?$/.exec(url.pathname)!;
    if (action === "parts") return partsRoute(req, params({ id }));
    if (action === "complete") return completeRoute(req, params({ id }));
    return { GET, PUT, DELETE }[req.method as "GET" | "PUT" | "DELETE"](req, params({ id }));
  };
}

async function submitWith(id: string, token: string) {
  const res = await submit(submitRequest("acme", submissionForm({ name: "Ada", consent: "on", videoUpload: id, videoUploadToken: token })), params({ slug: "acme" }));
  expect(res.status, await res.clone().text()).toBe(201);
  return getTestimonial((await res.json()).id)!;
}

describe("TEAM-05 L9 direct-to-S3 uploads", () => {
  it("TEAM-05 L9 presigned part URLs pin the size and type, and expire", async () => {
    const s3 = createS3Driver({ endpoint: ENDPOINT, region: REGION, bucket: BUCKET, ...KEYS, forcePathStyle: true, prefix: "", tmpDir: () => env.tmpDir, fetch: fake.fetch });
    const key = `tmp/${crypto.randomUUID()}`;
    const id = await s3.startMultipart(key, "video/webm");
    const url = s3.presignPart(key, id, 1, 16, "video/webm", 600);
    expect(url).toMatch(/X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost&/);
    const put = (body: Uint8Array, type = "video/webm", to = url) => fake.fetch(to, { method: "PUT", headers: { "Content-Type": type }, body: new Uint8Array(body) });
    expect((await put(new Uint8Array(17))).status).toBe(403); // not the size that was signed
    expect((await put(WEBM_BYTES, "image/png")).status).toBe(403); // nor the type
    const late = presignUrl(
      { method: "PUT", url: new URL(url.split("?")[0] + `?partNumber=1&uploadId=${id}`), expiresSec: 600, headers: { "content-length": "16", "content-type": "video/webm" } },
      KEYS,
      { region: REGION, service: "s3" },
      new Date(Date.now() - 11 * 60 * 1000),
    );
    const expired = await put(WEBM_BYTES, "video/webm", late);
    expect(expired.status).toBe(403);
    expect(await expired.text()).toMatch(/Request has expired/);
    expect((await put(WEBM_BYTES)).status).toBe(200);
    expect(await s3.listParts(key, id)).toEqual([{ partNumber: 1, size: 16, etag: expect.stringMatching(/^"[0-9a-f]{32}"$/) }]);
    // Media keys and staging keys don't mix.
    expect(() => s3.presignPart("videos/x.webm", id, 1, 16, "video/webm", 600)).toThrow("Invalid staging key");
    await s3.abortMultipart(key, id);
    expect(fake.uploads.size).toBe(0);
  });

  it("TEAM-05 L9 the browser sends a recording straight to the bucket in parts, and the submission moves it to its media key", async () => {
    const log: string[] = [];
    const data = webm(DIRECT_PART_BYTES + 1000);
    const upload = new ResumableUpload({ createUrl: "/api/projects/acme/uploads", fetch: browserFetch(log), retryDelayMs: 1 });
    // Recorded in pieces, as MediaRecorder hands them over.
    upload.append(new Blob([data.subarray(0, 5_000_000)], { type: "video/webm;codecs=vp9,opus" }));
    upload.append(new Blob([data.subarray(5_000_000)]));
    const { id, token } = await upload.finish();
    expect(upload.state).toMatchObject({ done: true, sent: data.length, error: null });
    expect(log).toEqual([
      "POST /api/projects/acme/uploads",
      `POST /api/uploads/${id}/parts`,
      "PUT bucket part",
      `POST /api/uploads/${id}/parts`,
      "PUT bucket part",
      `POST /api/uploads/${id}/complete`,
    ]);
    expect(sessions()[0]).toMatchObject({ direct: true, contentType: "video/webm", s3UploadId: null, received: data.length });
    expect(fs.readFileSync(`${env.tmpDir}/${id}.part`).length).toBe(0); // nothing came through the server

    const t = await submitWith(id, token);
    expect(t.videoKey).toMatch(/^videos\/[0-9a-f-]{36}\.webm$/);
    expect(fake.objects.get(`media/${t.videoKey}`)).toMatchObject({ contentType: "video/webm" });
    expect(fake.objects.get(`media/${t.videoKey}`)!.body.equals(data)).toBe(true);
    expect(staged()).toEqual([]);
    expect(sessions()).toEqual([]);
    expect(fake.requests.some((r) => r.method === "PUT" && r.headers["x-amz-copy-source"] === `/${BUCKET}/media/tmp/${id}`)).toBe(true);
  });

  it("TEAM-05 L9 falls back to the relayed path on the same session when the bucket refuses the browser (CORS)", async () => {
    const log: string[] = [];
    const cors = async () => {
      throw new TypeError("Failed to fetch");
    };
    const upload = new ResumableUpload({ createUrl: "/api/projects/acme/uploads", fetch: browserFetch(log, cors), retryDelayMs: 1 });
    const data = webm(3000);
    upload.append(new Blob([data], { type: "video/webm" }));
    const { id, token } = await upload.finish();
    expect(log).toEqual(["POST /api/projects/acme/uploads", `POST /api/uploads/${id}/parts`, "PUT bucket part", `PUT /api/uploads/${id}`]);
    expect(sessions()[0]).toMatchObject({ direct: false, s3UploadId: null, received: data.length });
    expect(fake.uploads.size).toBe(0); // the bucket's unfinished upload was aborted
    const t = await submitWith(id, token);
    expect(fake.objects.get(`media/${t.videoKey}`)!.body.equals(data)).toBe(true);
    expect(staged()).toEqual([]);
  });

  it("TEAM-05 L9 sniffs the finished object and deletes anything that isn't a video, SVG included", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    for (const bytes of [svg, PNG_BYTES]) {
      const { id, token, direct } = await start({ direct: true, contentType: "video/webm" });
      expect(direct).toEqual({ partSize: DIRECT_PART_BYTES });
      expect((await putPart(id, token, 1, bytes)).status).toBe(200);
      const res = await complete(id, token);
      expect(res.status).toBe(415);
      expect((await res.json()).error).toBe("This file isn't a video we can use. Choose a WebM, MP4, MOV or Ogg video.");
      expect(staged()).toEqual([]);
      expect(fake.uploads.size).toBe(0);
      expect((await complete(id, token)).status).toBe(404); // the session went with it
    }
    // A renamed photo can't be claimed through the relay either: the session is gone.
    expect(sessions()).toEqual([]);
  });

  it("TEAM-05 L9 keeps to the size limit and the part layout, and only for sessions it made", async () => {
    // The declared size is the limit.
    const small = await start({ direct: true, contentType: "video/webm", size: 100 });
    const over = await parts(small.id, small.token, { partNumber: 1, size: 101 });
    expect(over.status).toBe(413);
    expect((await parts(small.id, small.token, { partNumber: 1, size: 100 })).status).toBe(404); // dropped
    // Past MAX_VIDEO_MB by part number.
    const big = await start();
    const parts_ = Math.ceil(env.maxVideoBytes / DIRECT_PART_BYTES) + 1;
    expect((await parts(big.id, big.token, { partNumber: parts_, size: 1 })).status).toBe(413);
    // Bad input.
    const s = await start();
    for (const body of [{ partNumber: 0, size: 10 }, { partNumber: 1, size: DIRECT_PART_BYTES + 1 }, { partNumber: 1.5, size: 1 }, { size: 1 }]) {
      expect((await parts(s.id, s.token, body)).status).toBe(400);
    }
    expect((await parts(s.id, "not-the-token", { partNumber: 1, size: 10 })).status).toBe(404);
    // A short part that isn't the last doesn't fit.
    expect((await putPart(s.id, s.token, 1, webm(1000))).status).toBe(200);
    expect((await putPart(s.id, s.token, 2, webm(1000))).status).toBe(200);
    const misfit = await complete(s.id, s.token);
    expect(misfit.status).toBe(400);
    expect((await misfit.json()).error).toBe("The upload's parts don't fit together. Please try again.");
    expect(fake.uploads.size).toBe(0); // every refused session took its bucket upload with it
    expect(staged()).toEqual([]);
    // A relayed session has nothing to presign.
    const relayed = await start({});
    expect(relayed.direct).toBeUndefined();
    expect((await parts(relayed.id, relayed.token, { partNumber: 1, size: 10 })).status).toBe(409);
    expect((await complete(relayed.id, relayed.token)).status).toBe(409);
  });

  it("TEAM-05 L9 completing twice is fine, and abandoned or expired sessions leave nothing in the bucket", async () => {
    const a = await start();
    const data = webm(500);
    expect((await putPart(a.id, a.token, 1, data)).status).toBe(200);
    expect(await (await complete(a.id, a.token)).json()).toEqual({ offset: 500 });
    expect(await (await complete(a.id, a.token)).json()).toEqual({ offset: 500 });
    expect(staged()).toHaveLength(1);
    const del = await DELETE(new Request(`http://localhost/api/uploads/${a.id}`, { method: "DELETE", headers: { "x-upload-token": a.token } }), params({ id: a.id }));
    expect(del.status).toBe(200);
    expect(staged()).toEqual([]);

    const b = await start();
    expect((await putPart(b.id, b.token, 1, data)).status).toBe(200);
    expect(fake.uploads.size).toBe(1);
    await cleanupExpiredUploads(new Date(Date.now() + 25 * 60 * 60 * 1000));
    expect(fake.uploads.size).toBe(0);
    expect(sessions()).toEqual([]);
  });

  it("TEAM-05 L9 the dashboard's video uploads go direct too; archives never do", async () => {
    const projectId = getDb().select().from(schema.projects).get()!.id;
    const post = (body: unknown) =>
      startAdminUpload(new Request("http://localhost/api/admin/uploads", { method: "POST", body: JSON.stringify(body), headers: { ...adminHeaders(), "content-type": "application/json" } }));
    const video = await (await post({ kind: "video", projectId, direct: true, contentType: "video/mp4" })).json();
    expect(video.direct).toEqual({ partSize: DIRECT_PART_BYTES });
    expect(sessions().find((u) => u.id === video.id)).toMatchObject({ direct: true, contentType: "video/mp4" });
    const archive = await (await post({ direct: true })).json();
    expect(archive.direct).toBeUndefined();
    // A type we don't take is pinned as octet-stream; the sniff decides.
    const odd = await (await post({ kind: "video", projectId, direct: true, contentType: "image/svg+xml" })).json();
    expect(sessions().find((u) => u.id === odd.id)!.contentType).toBe("application/octet-stream");
  });

  it("TEAM-05 L9 is off unless STORAGE_DRIVER=s3 and S3_DIRECT_UPLOADS=true; only then do upload pages' CSP allow the bucket", async () => {
    const cspOf = (path: string) => proxy(new NextRequest(`https://plaudit.example${path}`)).headers.get("content-security-policy");
    const connect = (csp: string | null) => /connect-src ([^;]+)/.exec(csp ?? "")?.[1];
    expect(directUploadOrigin()).toBe(ENDPOINT);
    expect(connect(cspOf("/c/acme"))).toBe(`'self' ${ENDPOINT}`);
    expect(connect(cspOf("/f/acme/feedback"))).toBe(`'self' ${ENDPOINT}`);
    expect(cspOf("/embed/acme/form/feedback")).toContain("frame-ancestors *");
    expect(connect(cspOf("/embed/acme/form/feedback"))).toBe(`'self' ${ENDPOINT}`);
    expect(connect(cspOf("/admin/projects/x"))).toBe(`'self' ${ENDPOINT}`);
    expect(cspOf("/wall/acme")).toBe(publicCsp()); // pages that don't upload stay as they were
    expect(cspOf("/c/acme/thanks")).toBeNull();
    // Virtual-hosted buckets: the bucket's own host.
    process.env.S3_FORCE_PATH_STYLE = "false";
    expect(directUploadOrigin()).toBe(`http://${BUCKET}.minio.test:9000`);

    for (const off of [{ S3_DIRECT_UPLOADS: "false" }, { STORAGE_DRIVER: "local" }]) {
      Object.assign(process.env, S3_ENV, { S3_FORCE_PATH_STYLE: "true" }, off);
      expect(directUploadOrigin()).toBeNull();
      expect(cspOf("/c/acme")).toBeNull(); // next.config.ts's static policy applies, unchanged
      expect(connect(cspOf("/admin/projects/x"))).toBe("'self'");
      expect((await start()).direct).toBeUndefined();
    }
  });
});
