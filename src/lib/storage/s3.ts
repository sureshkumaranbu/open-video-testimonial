import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { StorageDriver } from "../storage";
import { isMediaKey } from "./local";
import { EMPTY_SHA256, presignUrl, sha256Hex, signRequest, UNSIGNED_PAYLOAD, uriEncode, type SigV4Credentials } from "./sigv4";

/**
 * Any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, Backblaze B2…)
 * spoken to over plain HTTPS with hand-written SigV4, so there's no SDK.
 * The server relays every byte (D16): uploads are put here once they've been
 * received and sniffed on disk, and /api/media streams objects back out.
 * With S3_DIRECT_UPLOADS (L9) browsers PUT video parts to `tmp/<id>`
 * through URLs presigned here; see src/lib/direct-upload.ts.
 */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type S3Config = {
  /** Scheme and host (and port), e.g. https://s3.eu-west-1.amazonaws.com or http://localhost:9000. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** Bucket in the path rather than the host name (MinIO usually needs it). */
  forcePathStyle: boolean;
  /** "" or "folder/": put in front of every key. */
  prefix: string;
  /** Where withLocalFile downloads temporary copies. */
  tmpDir: () => string;
  /** The global fetch unless a test hands in a fake S3. */
  fetch?: FetchLike;
  /** Files larger than this go up in parts. S3 needs every part but the last to be at least 5 MiB. */
  multipartThreshold?: number;
  partSize?: number;
};

export const MULTIPART_THRESHOLD = 64 * 1024 * 1024;
export const PART_SIZE = 16 * 1024 * 1024;

const SHORT_MS = 30_000;
const UPLOAD_MS = 10 * 60_000;
const DOWNLOAD_MS = 30 * 60_000;

/** A request S3 refused, with its HTTP status and S3 error code (NoSuchBucket, AccessDenied…). */
export class S3Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}

export interface S3Driver extends StorageDriver {
  name: "s3";
  bucket: string;
  /** Throws an S3Error saying what's wrong when the bucket can't be reached with these settings. */
  check(): Promise<void>;
  /** A link that downloads the object directly for `expiresSec` seconds (P1; Phase 1 relays media). */
  presignGet(key: string, expiresSec: number): string;
  /** L9: starts a multipart upload of a staging key (`tmp/<id>`) and returns its id. */
  startMultipart(key: string, mime: string): Promise<string>;
  /** L9: a URL that PUTs part `partNumber` of exactly `size` bytes of type `mime`, for `expiresSec` seconds. */
  presignPart(key: string, uploadId: string, partNumber: number, size: number, mime: string, expiresSec: number): string;
  /** L9: the parts the bucket holds for an upload, in order. */
  listParts(key: string, uploadId: string): Promise<{ partNumber: number; size: number; etag: string }[]>;
  completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
  /** Parts left behind are billed until aborted. An upload that's already gone is fine. */
  abortMultipart(key: string, uploadId: string): Promise<void>;
  /** Copies an object inside the bucket to a media key, with `mime` as its type (CopyObject: up to 5 GB). */
  copy(from: string, to: string, mime: string): Promise<void>;
}

/** Where a direct upload's bytes wait to be checked (L9). Never a media key, so /api/media can't serve them. */
const STAGING_RE = /^tmp\/[0-9a-f-]{36}$/;
export const isStagingKey = (key: string) => STAGING_RE.test(key);

/** The bucket's base URL: virtual-hosted (`bucket.host`) unless path style is forced. */
export function bucketRootOf(cfg: Pick<S3Config, "endpoint" | "bucket" | "forcePathStyle">) {
  const base = new URL(cfg.endpoint);
  const basePath = base.pathname.replace(/\/+$/, "");
  return cfg.forcePathStyle
    ? `${base.protocol}//${base.host}${basePath}/${uriEncode(cfg.bucket)}`
    : `${base.protocol}//${cfg.bucket}.${base.host}${basePath}`;
}

const xmlTag = (xml: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1] ?? null;
/** XML character references back to text: named ones, and numeric ones such as the `&#34;` MinIO (Go's encoding/xml) writes for a quote. */
const xmlUnescape = (s: string) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(quot|apos|lt|gt|amp));/gi, (_m, dec: string | undefined, hex: string | undefined, name: string | undefined) =>
    dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ({ quot: '"', apos: "'", lt: "<", gt: ">", amp: "&" } as Record<string, string>)[name!.toLowerCase()],
  );
const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** What a bare status means, for HEAD requests (they have no error body). */
function explainStatus(status: number) {
  if (status === 301 || status === 307) return "the bucket is in another region (check S3_REGION and S3_ENDPOINT)";
  if (status === 403) return "access denied (check S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and the key's permissions on the bucket)";
  if (status === 404) return "there's no such bucket (check S3_BUCKET)";
  return null;
}

async function failure(res: Response, what: string): Promise<S3Error> {
  const body = await res.text().catch(() => "");
  const code = xmlTag(body, "Code");
  const detail = xmlTag(body, "Message") ?? explainStatus(res.status);
  return new S3Error(res.status, code, `S3 ${what} failed with ${res.status}${code ? ` ${code}` : ""}${detail ? `: ${detail}` : ""}`);
}

/** Bytes start..end (inclusive) of a stream, for a server that ignored the Range header. */
function sliceStream(body: ReadableStream<Uint8Array>, start: number, end: number) {
  let offset = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const from = Math.max(start - offset, 0);
        const to = Math.min(end + 1 - offset, chunk.byteLength);
        offset += chunk.byteLength;
        if (from < to) controller.enqueue(chunk.subarray(from, to));
        if (offset > end) controller.terminate();
      },
    }),
  );
}

export function createS3Driver(cfg: S3Config): S3Driver {
  if (!cfg.bucket) throw new Error("S3 storage needs S3_BUCKET");
  if (!cfg.accessKeyId || !cfg.secretAccessKey) throw new Error("S3 storage needs S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
  let base: URL;
  try {
    base = new URL(cfg.endpoint);
  } catch {
    throw new Error(`S3_ENDPOINT isn't a URL: ${cfg.endpoint}`);
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") throw new Error("S3_ENDPOINT must start with https:// or http://");
  const doFetch = cfg.fetch ?? ((input, init) => fetch(input, init));
  const credentials: SigV4Credentials = { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, sessionToken: cfg.sessionToken };
  const scope = { region: cfg.region, service: "s3" };
  const multipartThreshold = cfg.multipartThreshold ?? MULTIPART_THRESHOLD;
  const partSize = Math.max(cfg.partSize ?? PART_SIZE, 1);
  const bucketRoot = bucketRootOf(cfg);

  const checkKey = (key: string) => {
    if (!isMediaKey(key)) throw new Error("Invalid media key");
  };
  /** Reads and deletes also take staging keys (L9). */
  const checkAnyKey = (key: string) => {
    if (!isMediaKey(key) && !isStagingKey(key)) throw new Error("Invalid media key");
  };
  const checkStaging = (key: string) => {
    if (!isStagingKey(key)) throw new Error("Invalid staging key");
  };
  /** The object's URL, already in the strict encoding SigV4 signs, so both sides agree on it. */
  const objectUrl = (key: string, query = "") => new URL(`${bucketRoot}/${uriEncode(cfg.prefix + key, true)}${query ? `?${query}` : ""}`);

  /**
   * One signed request. `timeoutMs` bounds the whole exchange, body included;
   * `headersTimeoutMs` only the wait for the reply to start, for bodies
   * streamed to a visitor for as long as they watch.
   */
  async function send(
    method: string,
    url: URL,
    o: { headers?: Record<string, string>; body?: BodyInit; payloadHash?: string; timeoutMs?: number; headersTimeoutMs?: number } = {},
  ) {
    const signed = signRequest({ method, url, headers: o.headers, payloadHash: o.payloadHash ?? EMPTY_SHA256 }, credentials, scope);
    const waiting = o.headersTimeoutMs ? new AbortController() : null;
    const timer = waiting ? setTimeout(() => waiting.abort(), o.headersTimeoutMs) : null;
    try {
      return await doFetch(url, {
        method,
        headers: signed.headers,
        body: o.body,
        signal: waiting?.signal ?? (o.timeoutMs ? AbortSignal.timeout(o.timeoutMs) : undefined),
      });
    } catch (err) {
      // fetch only says "fetch failed"; say where, and why.
      const e = err as Error & { cause?: { code?: string; message?: string } };
      if (waiting?.signal.aborted || e.name === "TimeoutError" || e.name === "AbortError") {
        throw new S3Error(0, "Timeout", `S3 at ${url.host} didn't answer in time`);
      }
      const why = e.cause?.code ?? e.cause?.message ?? e.message;
      throw new S3Error(0, e.cause?.code ?? null, `Couldn't reach S3 at ${url.host}: ${why} (check S3_ENDPOINT)`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Empties a response we don't need, so its connection can be reused. */
  const drain = async (res: Response) => {
    await res.body?.cancel().catch(() => undefined);
  };

  async function initiate(key: string, mime: string) {
    const start = await send("POST", objectUrl(key, "uploads"), { headers: { "content-type": mime }, timeoutMs: SHORT_MS });
    if (!start.ok) throw await failure(start, "upload");
    const uploadId = xmlTag(await start.text(), "UploadId");
    if (!uploadId) throw new S3Error(502, null, "S3 upload failed: no UploadId in the reply");
    return uploadId;
  }

  async function complete(key: string, id: string, parts: { n: number; etag: string }[]) {
    const xml = `<CompleteMultipartUpload>${parts
      .map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${xmlEscape(p.etag)}</ETag></Part>`)
      .join("")}</CompleteMultipartUpload>`;
    const done = await send("POST", objectUrl(key, `uploadId=${id}`), {
      headers: { "content-type": "application/xml" },
      body: xml,
      payloadHash: sha256Hex(xml),
      timeoutMs: UPLOAD_MS,
    });
    const reply = await done.text();
    // S3 can answer 200 and still report an error in the body.
    if (!done.ok || /<Error>/.test(reply)) {
      throw new S3Error(done.ok ? 500 : done.status, xmlTag(reply, "Code"), `S3 upload failed: ${xmlTag(reply, "Message") ?? done.status}`);
    }
  }

  async function multipartUpload(key: string, file: string, size: number, mime: string) {
    const id = uriEncode(await initiate(key, mime));
    const blob = await fs.openAsBlob(file);
    const parts: { n: number; etag: string }[] = [];
    try {
      for (let n = 1, from = 0; from < size; n++, from += partSize) {
        const res = await send("PUT", objectUrl(key, `partNumber=${n}&uploadId=${id}`), {
          body: blob.slice(from, Math.min(from + partSize, size)),
          payloadHash: UNSIGNED_PAYLOAD,
          timeoutMs: UPLOAD_MS,
        });
        if (!res.ok) throw await failure(res, "upload");
        await drain(res);
        const etag = res.headers.get("etag");
        if (!etag) throw new S3Error(502, null, `S3 upload failed: no ETag for part ${n}`);
        parts.push({ n, etag });
      }
      await complete(key, id, parts);
    } catch (err) {
      // Parts left behind are billed until aborted.
      await send("DELETE", objectUrl(key, `uploadId=${id}`), { timeoutMs: SHORT_MS }).then(drain, () => undefined);
      throw err;
    }
  }

  return {
    name: "s3",
    bucket: cfg.bucket,

    async put(key, src, mime) {
      checkKey(key);
      if ("bytes" in src) {
        const bytes = src.bytes as Uint8Array<ArrayBuffer>;
        const res = await send("PUT", objectUrl(key), {
          headers: { "content-type": mime },
          body: bytes,
          payloadHash: sha256Hex(bytes),
          timeoutMs: UPLOAD_MS,
        });
        if (!res.ok) throw await failure(res, "upload");
        await drain(res);
        return { size: bytes.byteLength };
      }
      const { size } = await fs.promises.stat(src.path);
      if (size > multipartThreshold) {
        await multipartUpload(key, src.path, size, mime);
      } else {
        // A file-backed Blob: streamed from disk with a known Content-Length.
        const res = await send("PUT", objectUrl(key), {
          headers: { "content-type": mime },
          body: await fs.openAsBlob(src.path),
          payloadHash: UNSIGNED_PAYLOAD,
          timeoutMs: UPLOAD_MS,
        });
        if (!res.ok) throw await failure(res, "upload");
        await drain(res);
      }
      if (src.move) await fs.promises.rm(src.path, { force: true });
      return { size };
    },

    async stat(key) {
      checkAnyKey(key);
      const res = await send("HEAD", objectUrl(key), { timeoutMs: SHORT_MS });
      if (res.status === 404) {
        await drain(res);
        return null;
      }
      if (!res.ok) throw await failure(res, "lookup");
      await drain(res);
      const size = Number(res.headers.get("content-length") ?? NaN);
      const modified = Date.parse(res.headers.get("last-modified") ?? "");
      const mtimeMs = Number.isFinite(modified) ? modified : 0;
      const raw = res.headers.get("etag");
      const etag = !raw ? `"${size.toString(36)}-${Math.floor(mtimeMs).toString(36)}"` : /^(W\/)?"/.test(raw) ? raw : `"${raw}"`;
      return { size: Number.isFinite(size) ? size : 0, etag, mtimeMs };
    },

    async read(key, range) {
      checkAnyKey(key);
      const res = await send("GET", objectUrl(key), {
        headers: range ? { range: `bytes=${range.start}-${range.end}` } : undefined,
        headersTimeoutMs: SHORT_MS,
      });
      if (res.status === 404) {
        await drain(res);
        return null;
      }
      if (!res.ok) throw await failure(res, "download");
      const body = res.body ?? new Response(new Uint8Array()).body!;
      return range && res.status !== 206 ? sliceStream(body, range.start, range.end) : body;
    },

    async remove(key) {
      checkAnyKey(key);
      const res = await send("DELETE", objectUrl(key), { timeoutMs: SHORT_MS });
      if (!res.ok && res.status !== 404) throw await failure(res, "delete");
      await drain(res);
    },

    async withLocalFile(key, fn) {
      checkKey(key);
      const dir = cfg.tmpDir();
      await fs.promises.mkdir(dir, { recursive: true });
      const file = path.join(dir, `s3-${crypto.randomUUID()}${path.extname(key)}`);
      try {
        const res = await send("GET", objectUrl(key), { timeoutMs: DOWNLOAD_MS });
        if (res.status === 404) await drain(res); // fn gets a path that doesn't exist, as with a missing local file
        else if (!res.ok) throw await failure(res, "download");
        else if (res.body) await pipeline(Readable.fromWeb(res.body as NodeReadableStream<Uint8Array>), fs.createWriteStream(file));
        else await fs.promises.writeFile(file, new Uint8Array());
        return await fn(file);
      } finally {
        await fs.promises.rm(file, { force: true });
      }
    },

    async check() {
      const res = await send("HEAD", new URL(cfg.forcePathStyle ? bucketRoot : `${bucketRoot}/`), { timeoutMs: 10_000 });
      if (!res.ok) throw await failure(res, "bucket check");
      await drain(res);
    },

    presignGet(key, expiresSec) {
      checkKey(key);
      return presignUrl({ method: "GET", url: objectUrl(key), expiresSec }, credentials, scope);
    },

    async startMultipart(key, mime) {
      checkStaging(key);
      return initiate(key, mime);
    },

    presignPart(key, uploadId, partNumber, size, mime, expiresSec) {
      checkStaging(key);
      const url = objectUrl(key, `partNumber=${partNumber}&uploadId=${uriEncode(uploadId)}`);
      return presignUrl({ method: "PUT", url, expiresSec, headers: { "content-length": String(size), "content-type": mime } }, credentials, scope);
    },

    async listParts(key, uploadId) {
      checkStaging(key);
      const parts: { partNumber: number; size: number; etag: string }[] = [];
      for (let marker = "0"; ; ) {
        const res = await send("GET", objectUrl(key, `part-number-marker=${marker}&uploadId=${uriEncode(uploadId)}`), { timeoutMs: SHORT_MS });
        if (!res.ok) throw await failure(res, "upload check");
        const xml = await res.text();
        for (const m of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
          const etag = xmlUnescape(xmlTag(m[1], "ETag") ?? "");
          parts.push({ partNumber: Number(xmlTag(m[1], "PartNumber")), size: Number(xmlTag(m[1], "Size")), etag });
        }
        const next = xmlTag(xml, "NextPartNumberMarker");
        if (xmlTag(xml, "IsTruncated") !== "true" || !next || next === marker) break;
        marker = next;
      }
      return parts.sort((a, b) => a.partNumber - b.partNumber);
    },

    async completeMultipart(key, uploadId, parts) {
      checkStaging(key);
      await complete(key, uriEncode(uploadId), parts.map((p) => ({ n: p.partNumber, etag: p.etag })));
    },

    async abortMultipart(key, uploadId) {
      checkStaging(key);
      const res = await send("DELETE", objectUrl(key, `uploadId=${uriEncode(uploadId)}`), { timeoutMs: SHORT_MS });
      if (!res.ok && res.status !== 404) throw await failure(res, "upload abort");
      await drain(res);
    },

    async copy(from, to, mime) {
      checkAnyKey(from);
      checkKey(to);
      const res = await send("PUT", objectUrl(to), {
        headers: {
          "content-type": mime,
          "x-amz-copy-source": `/${uriEncode(cfg.bucket)}/${uriEncode(cfg.prefix + from, true)}`,
          "x-amz-metadata-directive": "REPLACE",
        },
        timeoutMs: UPLOAD_MS,
      });
      const reply = await res.text();
      // Like CompleteMultipartUpload, a copy can answer 200 with an error in the body.
      if (!res.ok || /<Error>/.test(reply)) {
        throw new S3Error(res.ok ? 500 : res.status, xmlTag(reply, "Code"), `S3 copy failed: ${xmlTag(reply, "Message") ?? res.status}`);
      }
    },
  };
}
