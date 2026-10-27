import crypto from "node:crypto";

/**
 * An in-process stand-in for an S3-compatible bucket, reached through an
 * injected fetch rather than a port, so the tests run inside the sandbox.
 * It speaks just enough S3 for Plaudit's driver: PUT, multipart uploads, GET
 * with Range, HEAD, DELETE and HeadBucket, path-style or virtual-hosted. Every
 * request's SigV4 Authorization header is checked against the secret, with
 * its own implementation of the signing rules, so a header the driver sends
 * without signing (or signs but doesn't send) fails the way it would on S3.
 */
export type FakeObject = { body: Buffer; contentType: string; etag: string; lastModified: Date };
export type FakeRequest = { method: string; host: string; path: string; query: string; headers: Record<string, string>; bodyBytes: number };
type Upload = { key: string; contentType: string; parts: Map<number, { body: Buffer; etag: string }> };

export type FakeS3Options = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** S3 refuses parts smaller than 5 MiB (except the last); tests keep that rule. */
  minPartSize?: number;
};

const md5 = (b: Buffer) => crypto.createHash("md5").update(b).digest();
const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac("sha256", key).update(data).digest();
const strict = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const bytes = (b: Buffer) => new Uint8Array(b);

function xml(status: number, body: string, headers: Record<string, string> = {}) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, { status, headers: { "content-type": "application/xml", ...headers } });
}
function s3Error(status: number, code: string, message: string) {
  return xml(status, `<Error><Code>${code}</Code><Message>${message}</Message></Error>`);
}

export function createFakeS3(o: FakeS3Options) {
  const objects = new Map<string, FakeObject>();
  const uploads = new Map<string, Upload>();
  const requests: FakeRequest[] = [];
  const failures: { match: (r: FakeRequest) => boolean; status: number }[] = [];
  const minPartSize = o.minPartSize ?? 5 * 1024 * 1024;
  const state = { ignoreRange: false };

  /** null when the signature checks out, else why not. */
  function verify(method: string, url: URL, headers: Record<string, string>, body: Buffer): string | null {
    const auth = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/.exec(
      headers.authorization ?? "",
    );
    if (!auth) return "missing or malformed Authorization header";
    const [, keyId, day, region, signedHeaders, signature] = auth;
    if (keyId !== o.accessKeyId) return "unknown access key";
    if (region !== o.region) return `wrong region ${region}`;
    const date = headers["x-amz-date"] ?? "";
    if (!/^\d{8}T\d{6}Z$/.test(date) || !date.startsWith(day)) return "x-amz-date doesn't match the credential scope";
    const payload = headers["x-amz-content-sha256"];
    if (!payload) return "missing x-amz-content-sha256";
    if (payload !== "UNSIGNED-PAYLOAD" && payload !== sha256(body)) return "x-amz-content-sha256 doesn't match the body";
    const names = signedHeaders.split(";");
    for (const required of ["host", "x-amz-date", "x-amz-content-sha256"]) if (!names.includes(required)) return `${required} isn't signed`;
    if ([...names].sort().join(";") !== signedHeaders) return "SignedHeaders aren't sorted";
    const values: Record<string, string> = { ...headers, host: url.host };
    for (const n of names) if (values[n] === undefined) return `signed header ${n} wasn't sent`;
    const path = url.pathname
      .split("/")
      .map((s) => strict(decodeURIComponent(s)))
      .join("/");
    const query = url.search
      .slice(1)
      .split("&")
      .filter(Boolean)
      .map((p) => {
        const at = p.indexOf("=");
        const [k, v] = at < 0 ? [p, ""] : [p.slice(0, at), p.slice(at + 1)];
        return `${strict(decodeURIComponent(k))}=${strict(decodeURIComponent(v))}`;
      })
      .sort()
      .join("&");
    const canonical = [method, path, query, names.map((n) => `${n}:${values[n].trim().replace(/\s+/g, " ")}\n`).join(""), signedHeaders, payload].join("\n");
    const toSign = ["AWS4-HMAC-SHA256", date, `${day}/${region}/s3/aws4_request`, sha256(canonical)].join("\n");
    let k = hmac(`AWS4${o.secretAccessKey}`, day);
    for (const part of [region, "s3", "aws4_request"]) k = hmac(k, part);
    const expected = hmac(k, toSign).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature)) ? null : "signature doesn't match";
  }

  function getObject(key: string, method: string, range: string | undefined) {
    const obj = objects.get(key);
    if (!obj) return method === "HEAD" ? new Response(null, { status: 404 }) : s3Error(404, "NoSuchKey", "The specified key does not exist.");
    const base = {
      "content-type": obj.contentType,
      etag: obj.etag,
      "last-modified": obj.lastModified.toUTCString(),
      "accept-ranges": "bytes",
    };
    if (method === "HEAD") return new Response(null, { status: 200, headers: { ...base, "content-length": String(obj.body.length) } });
    const m = range && !state.ignoreRange ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    if (m) {
      const start = Number(m[1]);
      const end = m[2] === "" ? obj.body.length - 1 : Math.min(Number(m[2]), obj.body.length - 1);
      if (start > end) return s3Error(416, "InvalidRange", "The requested range is not satisfiable");
      return new Response(bytes(obj.body.subarray(start, end + 1)), {
        status: 206,
        headers: { ...base, "content-range": `bytes ${start}-${end}/${obj.body.length}` },
      });
    }
    return new Response(bytes(obj.body), { status: 200, headers: base });
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const body = Buffer.from(await req.arrayBuffer());
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => (headers[k] = v));
    const entry: FakeRequest = { method: req.method, host: url.host, path: url.pathname, query: url.search.slice(1), headers, bodyBytes: body.length };
    requests.push(entry);

    const failure = failures.findIndex((f) => f.match(entry));
    if (failure >= 0) {
      const [f] = failures.splice(failure, 1);
      return s3Error(f.status, "InternalError", "We encountered an internal error. Please try again.");
    }
    const problem = verify(req.method, url, headers, body);
    if (problem) return s3Error(403, "SignatureDoesNotMatch", problem);

    // Virtual-hosted (bucket.host/key) or path-style (host/bucket/key).
    const segments = url.pathname.split("/").slice(1).map(decodeURIComponent);
    const virtual = url.hostname.split(".")[0] === o.bucket && url.hostname !== o.bucket;
    const bucket = virtual ? o.bucket : segments.shift();
    const key = segments.join("/");
    if (bucket !== o.bucket) {
      return req.method === "HEAD" ? new Response(null, { status: 404 }) : s3Error(404, "NoSuchBucket", "The specified bucket does not exist");
    }
    if (!key) return req.method === "HEAD" ? new Response(null, { status: 200 }) : s3Error(501, "NotImplemented", "Not in the fake");

    const q = new URLSearchParams(url.search);
    const uploadId = q.get("uploadId");
    if (req.method === "POST" && q.has("uploads")) {
      const id = crypto.randomBytes(12).toString("hex");
      uploads.set(id, { key, contentType: headers["content-type"] ?? "binary/octet-stream", parts: new Map() });
      return xml(200, `<InitiateMultipartUploadResult><Bucket>${o.bucket}</Bucket><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (uploadId !== null) {
      const upload = uploads.get(uploadId);
      if (!upload || upload.key !== key) return s3Error(404, "NoSuchUpload", "The specified upload does not exist.");
      if (req.method === "PUT") {
        const n = Number(q.get("partNumber"));
        const etag = `"${md5(body).toString("hex")}"`;
        upload.parts.set(n, { body, etag });
        return new Response(null, { status: 200, headers: { etag } });
      }
      if (req.method === "DELETE") {
        uploads.delete(uploadId);
        return new Response(null, { status: 204 });
      }
      if (req.method === "POST") {
        const listed = [...body.toString("utf8").matchAll(/<Part><PartNumber>(\d+)<\/PartNumber><ETag>([^<]+)<\/ETag><\/Part>/g)].map((m) => ({
          n: Number(m[1]),
          etag: m[2].replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
        }));
        if (!listed.length) return s3Error(400, "MalformedXML", "No parts");
        const chosen = [];
        for (const [i, p] of listed.entries()) {
          const part = upload.parts.get(p.n);
          if (!part || part.etag !== p.etag) return s3Error(400, "InvalidPart", `Part ${p.n} wasn't uploaded`);
          if (i > 0 && p.n <= listed[i - 1].n) return s3Error(400, "InvalidPartOrder", "Parts must be in order");
          if (i < listed.length - 1 && part.body.length < minPartSize) return s3Error(400, "EntityTooSmall", `Part ${p.n} is too small`);
          chosen.push(part);
        }
        const etag = `"${md5(Buffer.concat(chosen.map((p) => md5(p.body)))).toString("hex")}-${chosen.length}"`;
        objects.set(key, { body: Buffer.concat(chosen.map((p) => p.body)), contentType: upload.contentType, etag, lastModified: new Date() });
        uploads.delete(uploadId);
        return xml(200, `<CompleteMultipartUploadResult><Bucket>${o.bucket}</Bucket><Key>${key}</Key><ETag>${etag.replace(/"/g, "&quot;")}</ETag></CompleteMultipartUploadResult>`);
      }
    }
    switch (req.method) {
      case "PUT": {
        const etag = `"${md5(body).toString("hex")}"`;
        objects.set(key, { body, contentType: headers["content-type"] ?? "binary/octet-stream", etag, lastModified: new Date() });
        return new Response(null, { status: 200, headers: { etag } });
      }
      case "GET":
      case "HEAD":
        return getObject(key, req.method, headers.range);
      case "DELETE":
        objects.delete(key);
        return new Response(null, { status: 204 });
    }
    return s3Error(405, "MethodNotAllowed", "Not in the fake");
  }

  return {
    objects,
    uploads,
    requests,
    state,
    /** A drop-in fetch for the S3 driver. */
    async fetch(input: string | URL | Request, init?: RequestInit) {
      const req = new Request(input, init);
      const res = await handle(req);
      // As over HTTP, a HEAD answer has no body, so errors arrive as a bare status.
      return req.method === "HEAD" && res.body ? new Response(null, { status: res.status, headers: res.headers }) : res;
    },
    /** The next request that matches gets a 500 (or `status`) instead. */
    failNext(match: (r: FakeRequest) => boolean, status = 500) {
      failures.push({ match, status });
    },
    /** Requests that changed something, e.g. to count PUTs. */
    writes() {
      return requests.filter((r) => r.method === "PUT" || r.method === "POST" || r.method === "DELETE");
    },
  };
}

export type FakeS3 = ReturnType<typeof createFakeS3>;
