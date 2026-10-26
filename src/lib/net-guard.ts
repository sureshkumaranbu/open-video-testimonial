import dnsCallback from "node:dns";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "./env";
import { PermanentJobError } from "./jobs";

/**
 * Every request Plaudit makes to an address someone else chose (a CSV's media
 * URLs, review-site importers, onboarding discovery, chat webhooks) goes
 * through here, so the server can't be pointed at its own network (SSRF):
 * private, loopback and link-local addresses are refused at connect time,
 * only http(s) is allowed, each redirect is checked again, and bodies and
 * waits are capped.
 *
 * Tests reach their local stand-in servers through NET_GUARD_ALLOW, an exact
 * list of host:port origins; the guard itself never switches off.
 */

// Loopback, private, link-local, carrier-grade NAT, benchmarking, multicast and
// reserved ranges, plus IPv4-mapped/NAT64 IPv6 (which can point back at them).
// Separate lists: a BlockList checks IPv4 addresses against IPv6 rules as
// mapped addresses, so one list with ::ffff:0:0/96 would block every IPv4 address.
const BLOCKED_V4 = new net.BlockList();
const BLOCKED_V6 = new net.BlockList();
for (const [net4, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
] as const) BLOCKED_V4.addSubnet(net4, bits, "ipv4");
for (const [net6, bits] of [
  ["::", 127], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) BLOCKED_V6.addSubnet(net6, bits, "ipv6");

export function isPrivateAddress(ip: string) {
  const family = net.isIP(ip);
  if (!family) return true;
  return family === 4 ? BLOCKED_V4.check(ip, "ipv4") : BLOCKED_V6.check(ip, "ipv6");
}

/** A request the guard refused, or one that broke a cap: retrying won't help. */
export class NetGuardError extends PermanentJobError {}
export class PrivateAddressError extends NetGuardError {}

/**
 * DNS lookup for outgoing requests that refuses private addresses. Checking
 * inside the connection's own lookup (rather than resolving separately first)
 * means a DNS answer can't change between the check and the connect.
 */
export const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dnsCallback.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dnsCallback.LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) {
      return callback(new PrivateAddressError(`Refusing to fetch from a private address (${hostname})`), "", 4);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: dnsCallback.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

/** True when NET_GUARD_ALLOW names exactly this host:port (tests only). */
export function isAllowedOrigin(url: URL) {
  const allow = env.netGuardAllow;
  if (!allow.length) return false;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return allow.includes(`${url.hostname.toLowerCase()}:${port}`);
}

/** Throws unless the URL is http(s), carries no credentials and isn't a private IP literal. */
function checkTarget(url: URL, allowPrivate: boolean) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new NetGuardError("Only http and https addresses can be fetched");
  if (url.username || url.password) throw new NetGuardError("Addresses with a user name or password can't be fetched");
  if (allowPrivate || isAllowedOrigin(url)) return;
  // IP literals skip DNS, so check them here.
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(literal) && isPrivateAddress(literal)) {
    throw new PrivateAddressError(`Refusing to fetch from a private address (${url.host})`);
  }
}

type RequestOptions = {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  allowPrivate: boolean;
};

function send(url: URL, o: RequestOptions) {
  return new Promise<http.IncomingMessage>((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const lookup = o.allowPrivate || isAllowedOrigin(url) ? undefined : guardedLookup;
    const req = client.request(url, { method: o.method, headers: o.headers, lookup, signal: o.signal }, resolve);
    req.on("error", reject);
    req.end(o.body);
  });
}

/** Follows up to `maxRedirects` redirects, checking every hop. POST becomes GET on 301–303. */
async function follow(start: string, o: RequestOptions & { maxRedirects: number }) {
  let current: URL;
  try {
    current = new URL(start);
  } catch {
    throw new NetGuardError("That isn't a web address");
  }
  let method = o.method;
  let body = o.body;
  for (let hop = 0; hop <= o.maxRedirects; hop++) {
    checkTarget(current, o.allowPrivate);
    const res = await send(current, { ...o, method, body });
    const location = res.headers.location;
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location) {
      res.resume();
      current = new URL(location, current);
      if (res.statusCode !== 307 && res.statusCode !== 308) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    return { res, url: current };
  }
  throw new NetGuardError("Too many redirects");
}

function timeoutSignal(ms: number, host: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`No answer from ${host} within ${Math.round(ms / 1000)} s`)), ms);
  timer.unref?.();
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "the site";
  }
}

const DEFAULT_TEXT_BYTES = 5 * 1024 * 1024;

export type PublicTextOptions = {
  maxBytes?: number;
  /** For the whole request, redirects and body included. */
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
};

export type PublicText = { status: number; text: string; finalUrl: string; contentType: string };

/**
 * Fetches a public page or API answer as text, whatever its status (callers
 * decide what a 403 or 404 means). Throws NetGuardError when refused or over
 * the size cap, and a plain Error on timeouts and network failures.
 */
export async function fetchPublicText(url: string, o: PublicTextOptions = {}): Promise<PublicText> {
  const maxBytes = o.maxBytes ?? DEFAULT_TEXT_BYTES;
  const timer = timeoutSignal(o.timeoutMs ?? 10_000, hostOf(url));
  try {
    const headers: Record<string, string> = {
      "user-agent": "Plaudit importer (+https://github.com/plaudit)",
      accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      ...o.headers,
    };
    if (o.body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
    const { res, url: final } = await follow(url, {
      method: o.method ?? "GET",
      headers,
      body: o.body,
      signal: timer.signal,
      allowPrivate: false,
      maxRedirects: 5,
    });
    if (Number(res.headers["content-length"] || 0) > maxBytes) {
      res.destroy();
      throw new NetGuardError(`The answer from ${final.host} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > maxBytes) {
        res.destroy();
        throw new NetGuardError(`The answer from ${final.host} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
      }
      chunks.push(chunk);
    }
    const contentType = String(res.headers["content-type"] ?? "");
    const charset = /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase() ?? "utf-8";
    let decoder: TextDecoder;
    try {
      decoder = new TextDecoder(charset);
    } catch {
      decoder = new TextDecoder("utf-8");
    }
    return { status: res.statusCode ?? 0, text: decoder.decode(Buffer.concat(chunks)), finalUrl: final.toString(), contentType };
  } catch (err) {
    if (timer.signal.aborted && !(err instanceof NetGuardError)) throw timer.signal.reason instanceof Error ? timer.signal.reason : new Error(`No answer from ${hostOf(url)}`);
    throw err;
  } finally {
    timer.done();
  }
}

/**
 * POSTs JSON to a public endpoint (chat webhooks). `allowHosts` limits the
 * host names further; an origin in NET_GUARD_ALLOW passes that list too.
 */
export async function postPublicJson(url: string, body: unknown, o: { timeoutMs?: number; allowHosts?: RegExp[] } = {}) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new NetGuardError("That isn't a web address");
  }
  if (o.allowHosts && !isAllowedOrigin(parsed) && !o.allowHosts.some((re) => re.test(parsed.hostname))) {
    throw new NetGuardError(`Sending to ${parsed.hostname} isn't allowed`);
  }
  const res = await fetchPublicText(url, { method: "POST", body: JSON.stringify(body), timeoutMs: o.timeoutMs ?? 10_000, maxBytes: 64 * 1024 });
  return { status: res.status, text: res.text };
}

/**
 * Downloads a public file to disk with a size cap, following up to 5
 * redirects. Private-network addresses are refused (a CSV from elsewhere
 * shouldn't make the server fetch internal URLs) unless
 * IMPORT_ALLOW_PRIVATE_URLS=true. Returns the size in bytes.
 */
export async function downloadPublic(url: string, dest: string, maxBytes: number) {
  const timer = timeoutSignal(10 * 60_000, hostOf(url));
  try {
    const { res, url: final } = await follow(url, {
      method: "GET",
      headers: { "user-agent": "Plaudit importer" },
      signal: timer.signal,
      allowPrivate: env.importAllowPrivateUrls,
      maxRedirects: 5,
    });
    if (res.statusCode !== 200) {
      res.resume();
      throw new Error(`HTTP ${res.statusCode} for ${final.host}`);
    }
    if (Number(res.headers["content-length"] || 0) > maxBytes) {
      res.destroy();
      throw new PermanentJobError("File too large");
    }
    let size = 0;
    const cap = new Transform({
      transform(chunk: Buffer, _enc, done) {
        size += chunk.length;
        done(size > maxBytes ? new PermanentJobError("File too large") : null, chunk);
      },
    });
    await pipeline(res, cap, fs.createWriteStream(dest));
    return size;
  } finally {
    timer.done();
  }
}
