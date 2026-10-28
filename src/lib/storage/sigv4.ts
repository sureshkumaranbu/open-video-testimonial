import crypto from "node:crypto";

/**
 * AWS Signature Version 4, written out with node:crypto so S3-compatible
 * storage needs no SDK. It follows the S3 flavour of the spec: the path is
 * encoded once (never normalised or double-encoded) and the payload hash is
 * sent in `x-amz-content-sha256`. Checked against AWS's documented examples
 * in tests/storage-s3.test.ts.
 */
export type SigV4Credentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
export type SigV4Scope = { region: string; service: string };

const ALGORITHM = "AWS4-HMAC-SHA256";

/** The payload hash to send when the body isn't hashed (streamed uploads). */
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

/** sha256 of the empty string: the payload hash of a GET, HEAD or DELETE. */
export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function sha256Hex(data: string | Uint8Array) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key: crypto.BinaryLike, data: string) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

/**
 * RFC 3986 encoding as SigV4 wants it: every byte except A–Z, a–z, 0–9 and
 * `-._~` becomes %XX (upper case). `/` is kept only when `keepSlash`, for paths.
 */
export function uriEncode(value: string, keepSlash = false) {
  // encodeURIComponent leaves !'()* alone; SigV4 doesn't.
  const encoded = encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? encoded.replace(/%2F/g, "/") : encoded;
}

/** 20130524T000000Z */
export function amzDate(now: Date) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function decode(part: string) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** Each path segment decoded and encoded again, so `$` and `%24` sign the same. */
function canonicalUri(url: URL) {
  return url.pathname.split("/").map((s) => uriEncode(decode(s))).join("/") || "/";
}

/** Query pairs sorted by name then value. `+` stays a plus: S3 never reads it as a space. */
function canonicalQuery(search: string) {
  const pairs = search
    .replace(/^\?/, "")
    .split("&")
    .filter(Boolean)
    .map((p) => {
      const at = p.indexOf("=");
      const [k, v] = at < 0 ? [p, ""] : [p.slice(0, at), p.slice(at + 1)];
      return [uriEncode(decode(k)), uriEncode(decode(v))] as const;
    });
  pairs.sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

/** The derived key for one day, region and service. */
export function signingKey(secretAccessKey: string, dateStamp: string, scope: SigV4Scope) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, scope.region);
  const kService = hmac(kRegion, scope.service);
  return hmac(kService, "aws4_request");
}

export type SignedRequest = {
  /** Headers to send. `host` isn't among them: fetch sets it from the URL, to the same value that was signed. */
  headers: Record<string, string>;
  authorization: string;
  signature: string;
  canonicalRequest: string;
  stringToSign: string;
};

/**
 * Signs a request in the Authorization header. Every header passed in is
 * signed (plus `host`, `x-amz-date`, `x-amz-content-sha256` and, with a
 * session token, `x-amz-security-token`), so pass only what will be sent.
 */
export function signRequest(
  req: { method: string; url: URL; headers?: Record<string, string>; payloadHash: string },
  credentials: SigV4Credentials,
  scope: SigV4Scope,
  now = new Date(),
): SignedRequest {
  const date = amzDate(now);
  const dateStamp = date.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = v;
  headers["x-amz-date"] = date;
  headers["x-amz-content-sha256"] = req.payloadHash;
  if (credentials.sessionToken) headers["x-amz-security-token"] = credentials.sessionToken;

  const signed: Record<string, string> = { ...headers, host: req.url.host };
  const names = Object.keys(signed).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(signed[n]).trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    req.method.toUpperCase(),
    canonicalUri(req.url),
    canonicalQuery(req.url.search),
    canonicalHeaders,
    signedHeaders,
    req.payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${scope.region}/${scope.service}/aws4_request`;
  const stringToSign = [ALGORITHM, date, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(credentials.secretAccessKey, dateStamp, scope), stringToSign).toString("hex");
  const authorization = `${ALGORITHM} Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers: { ...headers, authorization }, authorization, signature, canonicalRequest, stringToSign };
}

/**
 * A presigned URL (query-string auth) that works for `expiresSec` seconds.
 * Media is still served through the app (D16); direct uploads (L9) presign
 * each part's PUT with `headers` signed too (`content-length`,
 * `content-type`), so S3 refuses a body of another size or type. The
 * request must then send exactly those headers.
 */
export function presignUrl(
  req: { method: string; url: URL; expiresSec: number; headers?: Record<string, string> },
  credentials: SigV4Credentials,
  scope: SigV4Scope,
  now = new Date(),
) {
  const date = amzDate(now);
  const dateStamp = date.slice(0, 8);
  const credentialScope = `${dateStamp}/${scope.region}/${scope.service}/aws4_request`;
  const url = new URL(req.url);
  const signed: Record<string, string> = { host: url.host };
  for (const [k, v] of Object.entries(req.headers ?? {})) signed[k.toLowerCase()] = v;
  const names = Object.keys(signed).sort();
  const params: [string, string][] = [
    ["X-Amz-Algorithm", ALGORITHM],
    ["X-Amz-Credential", `${credentials.accessKeyId}/${credentialScope}`],
    ["X-Amz-Date", date],
    ["X-Amz-Expires", String(Math.max(1, Math.min(Math.floor(req.expiresSec), 604800)))],
    ["X-Amz-SignedHeaders", names.join(";")],
  ];
  if (credentials.sessionToken) params.push(["X-Amz-Security-Token", credentials.sessionToken]);
  const extra = params.map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join("&");
  url.search = url.search ? `${url.search.slice(1)}&${extra}` : extra;
  const canonicalRequest = [
    req.method.toUpperCase(),
    canonicalUri(url),
    canonicalQuery(url.search),
    names.map((n) => `${n}:${String(signed[n]).trim().replace(/\s+/g, " ")}\n`).join(""),
    names.join(";"),
    UNSIGNED_PAYLOAD,
  ].join("\n");
  const stringToSign = [ALGORITHM, date, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(credentials.secretAccessKey, dateStamp, scope), stringToSign).toString("hex");
  return `${url.origin}${url.pathname}?${canonicalQuery(url.search)}&X-Amz-Signature=${signature}`;
}
