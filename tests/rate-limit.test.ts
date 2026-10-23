import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/admin/login/route";
import { clientIp, loginDelayMs, resetRateLimits } from "@/lib/rate-limit";
import { ADMIN_EMAIL, ADMIN_PASSWORD, useTempDataDir } from "./helpers";

type PeerGlobal = { __plauditPeerHeader?: boolean };

const req = (headers: Record<string, string>) => new Request("http://localhost/x", { headers });

describe("clientIp", () => {
  const g = globalThis as PeerGlobal;
  afterEach(() => {
    delete process.env.TRUST_PROXY;
    delete g.__plauditPeerHeader;
  });

  it("ignores forwarding headers unless TRUST_PROXY is set", () => {
    g.__plauditPeerHeader = true;
    const r = req({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7", "x-plaudit-peer": "192.0.2.10" });
    expect(clientIp(r)).toBe("192.0.2.10");
  });

  it("only believes the peer header when peer-ip.mjs has marked the process", () => {
    expect(clientIp(req({ "x-plaudit-peer": "192.0.2.10" }))).toBeNull();
    g.__plauditPeerHeader = true;
    expect(clientIp(req({ "x-plaudit-peer": "192.0.2.10" }))).toBe("192.0.2.10");
    expect(clientIp(req({}))).toBeNull();
  });

  it("with TRUST_PROXY, takes the address the trusted proxy appended, not what the client wrote", () => {
    g.__plauditPeerHeader = true;
    process.env.TRUST_PROXY = "true";
    const spoofed = { "x-forwarded-for": "6.6.6.6, 203.0.113.9", "x-plaudit-peer": "10.0.0.2" };
    expect(clientIp(req(spoofed))).toBe("203.0.113.9");
    process.env.TRUST_PROXY = "2";
    expect(clientIp(req(spoofed))).toBe("6.6.6.6");
    // A chain shorter than the proxies configured: fall back to the peer.
    process.env.TRUST_PROXY = "3";
    expect(clientIp(req(spoofed))).toBe("10.0.0.2");
    process.env.TRUST_PROXY = "false";
    expect(clientIp(req(spoofed))).toBe("10.0.0.2");
  });
});

describe("peer-ip.mjs", () => {
  afterAll(() => {
    delete (globalThis as PeerGlobal).__plauditPeerHeader;
  });

  it("overwrites a client-supplied peer header with the socket address", async () => {
    await import(pathToFileURL(path.resolve(__dirname, "../scripts/peer-ip.mjs")).href);
    expect((globalThis as PeerGlobal).__plauditPeerHeader).toBe(true);
    const server = http.createServer((r, res) => res.end(String(r.headers["x-plaudit-peer"])));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { "x-plaudit-peer": "6.6.6.6" } });
      expect(await res.text()).toBe("127.0.0.1");
    } finally {
      server.close();
    }
  });
});

describe("login rate limiting", () => {
  let env: ReturnType<typeof useTempDataDir>;
  const g = globalThis as PeerGlobal;

  beforeEach(() => {
    env = useTempDataDir();
    resetRateLimits();
    delete process.env.TRUST_PROXY; // no reverse proxy: forwarding headers are client-made
    g.__plauditPeerHeader = true;
    vi.useFakeTimers({ toFake: ["setTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    delete g.__plauditPeerHeader;
    env.cleanup();
  });

  /** Runs the login route, skipping through its backoff delay. */
  async function attempt(peer: string, password: string, extra: Record<string, string> = {}) {
    const pending = login(
      new Request("http://localhost/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-plaudit-peer": peer, ...extra },
        body: JSON.stringify({ email: ADMIN_EMAIL, password }),
      }),
    );
    await vi.runAllTimersAsync();
    return (await pending).status;
  }

  it("a made-up X-Forwarded-For on every guess doesn't reset the limit", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push(await attempt("198.51.100.9", "wrong", { "x-forwarded-for": `203.0.113.${i}`, "x-real-ip": `192.0.2.${i}` }));
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it("an attacker's failures never lock the owner out", async () => {
    for (let i = 0; i < 12; i++) await attempt("198.51.100.9", "wrong");
    expect(await attempt("198.51.100.9", "wrong")).toBe(429);
    // The owner, from their own address, still gets in (after a short backoff).
    expect(await attempt("203.0.113.50", ADMIN_PASSWORD)).toBe(200);
  });

  it("clients that can't be identified get backoff, not a shared lockout", async () => {
    delete g.__plauditPeerHeader; // e.g. started without peer-ip.mjs
    for (let i = 0; i < 15; i++) expect(await attempt("", "wrong")).toBe(401);
    expect(await attempt("", ADMIN_PASSWORD)).toBe(200);
  });

  it("a successful sign-in clears that client's failures", async () => {
    for (let i = 0; i < 9; i++) await attempt("198.51.100.20", "wrong");
    expect(await attempt("198.51.100.20", ADMIN_PASSWORD)).toBe(200);
    for (let i = 0; i < 9; i++) expect(await attempt("198.51.100.20", "wrong")).toBe(401);
  });
});

describe("loginDelayMs", () => {
  it("is free for the first few failures, then grows and caps", () => {
    expect([0, 4].map(loginDelayMs)).toEqual([0, 0]);
    expect(loginDelayMs(5)).toBe(250);
    expect(loginDelayMs(6)).toBe(500);
    expect(loginDelayMs(20)).toBe(4000);
  });
});
