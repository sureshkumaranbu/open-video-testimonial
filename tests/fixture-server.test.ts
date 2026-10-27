import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer } from "../e2e/fixtures/fixture-server.mjs";

/** The e2e stand-in for the outside web: static fixtures plus a request recorder. */

let base: string;
let root: string;
let server: Awaited<ReturnType<typeof startFixtureServer>>;

beforeAll(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "plaudit-fixtures-"));
  root = path.join(base, "fixtures");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(base, "secret.txt"), "outside the fixtures");
  fs.mkdirSync(path.join(root, "importers/appstore"), { recursive: true });
  fs.writeFileSync(path.join(root, "importers/appstore/feed.json"), JSON.stringify({ feed: { entry: [] } }));
  fs.mkdirSync(path.join(root, "site"));
  fs.writeFileSync(path.join(root, "site/index.html"), "<h1>Kind words</h1>");
  fs.writeFileSync(path.join(root, "robots.txt"), "User-agent: *\nDisallow: /private");
  server = await startFixtureServer({ root });
});
afterAll(async () => {
  await server.close();
  fs.rmSync(base, { recursive: true, force: true });
});
beforeEach(() => server.reset());

/** A raw request, so `..` reaches the server as sent (fetch would normalise it). */
function rawGet(p: string) {
  return new Promise<number>((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: server.port, path: p }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }).on("error", reject);
  });
}

describe("fixture server", () => {
  it("serves fixture files with their type, and a folder's index", async () => {
    const feed = await fetch(`${server.url}/importers/appstore/feed.json?page=1`);
    expect(feed.status).toBe(200);
    expect(feed.headers.get("content-type")).toBe("application/json");
    expect(await feed.json()).toEqual({ feed: { entry: [] } });

    const site = await fetch(`${server.url}/site/`);
    expect(site.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await site.text()).toBe("<h1>Kind words</h1>");
    expect(await (await fetch(`${server.url}/robots.txt`)).text()).toContain("Disallow: /private");
    expect((await fetch(`${server.url}/nope.json`)).status).toBe(404);
  });

  it("never serves a file outside its folder", async () => {
    expect(await rawGet("/..%2fsecret.txt")).toBe(404);
    expect(await rawGet("/site/..%2f..%2fsecret.txt")).toBe(404);
    expect(await rawGet("/../secret.txt")).toBe(404);
  });

  it("records what is sent to it, and filters by path and method", async () => {
    const post = await fetch(`${server.url}/hooks/slack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "New testimonial ★★★★★" }),
    });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ ok: true });
    await fetch(`${server.url}/importers/appstore/feed.json`);

    const res = await fetch(`${server.url}/__requests?path=/hooks&method=post`);
    const recorded = await res.json();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ method: "POST", path: "/hooks/slack", json: { text: "New testimonial ★★★★★" } });
    expect(server.requests("/importers")).toHaveLength(1);

    await fetch(`${server.url}/__requests`, { method: "DELETE" });
    expect(server.requests()).toEqual([]);
  });

  it("gives canned answers, for a set number of times and per query", async () => {
    await fetch(`${server.url}/__responses`, { method: "PUT", body: JSON.stringify({ path: "/hooks/flaky", status: 500, body: "boom", times: 1 }) });
    await fetch(`${server.url}/__responses`, {
      method: "PUT",
      body: JSON.stringify({ path: "/api/reviews?page=2", body: { reviews: ["second page"] }, delayMs: 50 }),
    });
    const first = await fetch(`${server.url}/hooks/flaky`, { method: "POST", body: "{}" });
    expect([first.status, await first.text()]).toEqual([500, "boom"]);
    expect((await fetch(`${server.url}/hooks/flaky`, { method: "POST", body: "{}" })).status).toBe(200);

    const started = Date.now();
    expect(await (await fetch(`${server.url}/api/reviews?page=2`)).json()).toEqual({ reviews: ["second page"] });
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
    expect((await fetch(`${server.url}/api/reviews?page=3`)).status).toBe(404);
    expect(server.requests("/hooks/flaky")).toHaveLength(2);
  });
});
