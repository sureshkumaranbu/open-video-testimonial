import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchPublicText, isAllowedOrigin, isPrivateAddress, NetGuardError, postPublicJson } from "@/lib/net-guard";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let servers: http.Server[] = [];

async function serve(handler: Handler) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return `127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => {
  servers = [];
});
afterEach(async () => {
  delete process.env.NET_GUARD_ALLOW;
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

describe("IMP-01 net-guard", () => {
  it("IMP-01 classifies private, loopback, link-local and mapped addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "64:ff9b::7f00:1", "not-an-ip"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("IMP-01 refuses private addresses by IP and by name, other schemes and credentials", async () => {
    const host = await serve((_req, res) => res.end("secret"));
    const port = host.split(":")[1];
    await expect(fetchPublicText(`http://${host}/`)).rejects.toThrow(/private address/);
    await expect(fetchPublicText(`http://localhost:${port}/`)).rejects.toThrow(/private address/);
    await expect(fetchPublicText(`http://[::ffff:127.0.0.1]:${port}/`)).rejects.toThrow(/private address/);
    await expect(fetchPublicText("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/private address/);
    await expect(fetchPublicText("file:///etc/passwd")).rejects.toBeInstanceOf(NetGuardError);
    await expect(fetchPublicText("http://user:pass@example.com/")).rejects.toThrow(/user name or password/);
  });

  it("IMP-01 NET_GUARD_ALLOW lets exactly the listed host:port through", async () => {
    const host = await serve((_req, res) => res.end("hello"));
    const other = await serve((_req, res) => res.end("other"));
    process.env.NET_GUARD_ALLOW = host;
    expect(isAllowedOrigin(new URL(`http://${host}/x`))).toBe(true);
    expect(isAllowedOrigin(new URL(`http://${other}/x`))).toBe(false);
    expect(isAllowedOrigin(new URL("http://127.0.0.1/x"))).toBe(false);
    await expect(fetchPublicText(`http://${host}/`)).resolves.toMatchObject({ status: 200, text: "hello" });
    await expect(fetchPublicText(`http://${other}/`)).rejects.toThrow(/private address/);
  });

  it("IMP-01 checks every redirect again", async () => {
    const inside = await serve((_req, res) => res.end("internal"));
    const host = await serve((req, res) => {
      const to = req.url === "/meta" ? "http://169.254.169.254/" : req.url === "/scheme" ? "file:///etc/passwd" : `http://${inside}/`;
      res.writeHead(302, { location: to }).end();
    });
    process.env.NET_GUARD_ALLOW = host;
    await expect(fetchPublicText(`http://${host}/`)).rejects.toThrow(/private address/);
    await expect(fetchPublicText(`http://${host}/meta`)).rejects.toThrow(/private address/);
    await expect(fetchPublicText(`http://${host}/scheme`)).rejects.toBeInstanceOf(NetGuardError);
  });

  it("IMP-01 caps the size, with or without a Content-Length", async () => {
    const host = await serve((req, res) => {
      if (req.url === "/chunked") {
        res.write("x".repeat(800));
        res.end("x".repeat(800));
      } else res.end("y".repeat(5000));
    });
    process.env.NET_GUARD_ALLOW = host;
    await expect(fetchPublicText(`http://${host}/`, { maxBytes: 1000 })).rejects.toThrow(/larger than/);
    await expect(fetchPublicText(`http://${host}/chunked`, { maxBytes: 1000 })).rejects.toThrow(/larger than/);
    await expect(fetchPublicText(`http://${host}/chunked`, { maxBytes: 2000 })).resolves.toMatchObject({ status: 200 });
  });

  it("IMP-01 gives up after the timeout, for headers and for a slow body", async () => {
    const host = await serve((req, res) => {
      if (req.url === "/slow-body") {
        res.writeHead(200);
        res.write("start");
      }
      // Otherwise never answers.
    });
    process.env.NET_GUARD_ALLOW = host;
    const started = Date.now();
    await expect(fetchPublicText(`http://${host}/`, { timeoutMs: 200 })).rejects.toThrow(/No answer/);
    await expect(fetchPublicText(`http://${host}/slow-body`, { timeoutMs: 200 })).rejects.toThrow(/No answer/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("IMP-01 posts JSON only to allowed hosts", async () => {
    let got = "";
    const host = await serve((req, res) => {
      req.on("data", (c) => (got += c));
      req.on("end", () => res.end("ok"));
    });
    await expect(postPublicJson("https://evil.example/hook", { a: 1 }, { allowHosts: [/^hooks\.slack\.com$/] })).rejects.toThrow(/isn't allowed/);
    process.env.NET_GUARD_ALLOW = host;
    await expect(postPublicJson(`http://${host}/hook`, { a: 1 }, { allowHosts: [/^hooks\.slack\.com$/] })).resolves.toMatchObject({ status: 200, text: "ok" });
    expect(JSON.parse(got)).toEqual({ a: 1 });
  });
});
