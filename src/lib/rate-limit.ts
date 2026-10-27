import { env } from "./env";

/**
 * Tiny in-memory fixed-window rate limiter. Good enough for a single
 * self-hosted instance; swap for Redis if you run several replicas.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Public endpoints (beacons, webhooks) key buckets by address, so expired
 * ones are swept every so often and the map has a ceiling: requests from
 * many addresses can't grow memory without end. Past the ceiling the oldest
 * buckets go first, which only makes limiting more lenient for a moment.
 */
const SWEEP_EVERY = 1000;
const MAX_BUCKETS = 100_000;
let sinceSweep = 0;

function sweep(now: number) {
  sinceSweep = 0;
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
  for (const key of buckets.keys()) {
    if (buckets.size <= MAX_BUCKETS) break;
    buckets.delete(key);
  }
}

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  if (++sinceSweep >= SWEEP_EVERY || buckets.size > MAX_BUCKETS) sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

/** How many requests are counted in a bucket's current window (0 if none). */
export function rateCount(key: string, now = Date.now()) {
  const bucket = buckets.get(key);
  return bucket && bucket.resetAt > now ? bucket.count : 0;
}

export function clearRateLimit(key: string) {
  buckets.delete(key);
}

/** Wrong passwords from anywhere before every login attempt starts to slow down. */
const FREE_FAILURES = 5;
const MAX_DELAY_MS = 4000;

/**
 * Backoff for the single admin account: after a few wrong passwords from
 * anywhere, each attempt waits a little longer (up to a few seconds). It
 * slows guessing spread across many addresses without ever locking the
 * owner out, which a shared hard limit would let any stranger do.
 */
export function loginDelayMs(recentFailures: number) {
  if (recentFailures < FREE_FAILURES) return 0;
  return Math.min(250 * 2 ** (recentFailures - FREE_FAILURES), MAX_DELAY_MS);
}

const PEER_HEADER = "x-plaudit-peer";

/**
 * The client's address, or null when it can't be known.
 *
 * The base is the TCP peer address, which scripts/peer-ip.mjs writes into a
 * header on every request (overwriting anything the client sent). Only when
 * TRUST_PROXY says N reverse proxies sit in front do we look at
 * X-Forwarded-For, and then only at the entry the outermost trusted proxy
 * appended: N from the end. Anything to the left of it is client-supplied.
 */
export function clientIp(req: Request): string | null {
  return clientIpFrom(req.headers);
}

/** clientIp() for a server page, which has the request's headers (next/headers) rather than the Request. */
export function clientIpFrom(headers: Pick<Headers, "get">): string | null {
  const peerTrusted = (globalThis as { __plauditPeerHeader?: boolean }).__plauditPeerHeader === true;
  const peer = (peerTrusted && headers.get(PEER_HEADER)) || null;
  const hops = env.trustProxyHops;
  if (hops > 0) {
    const chain = (headers.get("x-forwarded-for") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (chain.length >= hops) return chain[chain.length - hops];
    const realIp = headers.get("x-real-ip")?.trim();
    if (realIp) return realIp;
  }
  return peer;
}

/** Rate-limit key for a client; clients we can't identify share one bucket. */
export function clientKey(req: Request) {
  return clientIp(req) ?? "unidentified";
}

export function resetRateLimits() {
  buckets.clear();
  sinceSweep = 0;
}

/** How many buckets are held (for tests). */
export const rateLimitBucketCount = () => buckets.size;
