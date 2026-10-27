/**
 * A local stand-in for the outside web, for tests only. It serves files from
 * tests/fixtures/** (review-site pages and feeds for importers, a site to
 * discover testimonials on) and records every request, so a test can check
 * what Plaudit posted to a chat webhook or other receiver. The app reaches it
 * through NET_GUARD_ALLOW and IMPORTER_ORIGINS (see playwright.config.ts).
 *
 *   node e2e/fixtures/fixture-server.mjs   (FIXTURE_PORT, FIXTURE_HOST, FIXTURE_ROOT)
 *
 * Control endpoints, never recorded:
 *   GET    /__health                       "ok"
 *   GET    /__requests?path=/x&method=POST recorded requests, oldest first (path is a prefix)
 *   DELETE /__requests                     forget them
 *   PUT    /__responses                    {path, status?, headers?, body?, delayMs?, times?}: a canned
 *                                          answer for a path, with its query or without
 *   DELETE /__responses                    forget canned answers
 * Anything else gets its canned answer if one is set. Otherwise GET and HEAD
 * serve the file (a folder serves index.html or index.json) and other methods
 * answer 200 {"ok":true}.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "tests", "fixtures");
const MAX_BODY = 5 * 1024 * 1024;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".json": "application/json",
  ".xml": "application/xml",
  ".rss": "application/rss+xml",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
};

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size <= MAX_BODY) chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/** The file a URL path names inside root, or null (missing, or outside root). */
function resolveFile(root, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = path.resolve(root, `.${rel}`);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(file)) return null;
  if (fs.statSync(file).isDirectory()) {
    for (const index of ["index.html", "index.json"]) {
      if (fs.existsSync(path.join(file, index))) return path.join(file, index);
    }
    return null;
  }
  return file;
}

export async function startFixtureServer({ port = 0, host = "127.0.0.1", root = DEFAULT_ROOT } = {}) {
  root = path.resolve(root);
  const recorded = [];
  const canned = new Map();

  const send = (res, status, body, headers = {}) => {
    const isText = typeof body === "string" || Buffer.isBuffer(body);
    res.writeHead(status, { "content-type": isText ? "text/plain; charset=utf-8" : "application/json", ...headers });
    res.end(isText ? body : JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture");
    const body = await readBody(req);
    try {
      if (url.pathname === "/__health") return send(res, 200, "ok");
      if (url.pathname === "/__requests") {
        if (req.method === "DELETE") {
          recorded.length = 0;
          return send(res, 200, { ok: true });
        }
        const prefix = url.searchParams.get("path") ?? "";
        const method = url.searchParams.get("method")?.toUpperCase();
        return send(res, 200, recorded.filter((r) => r.path.startsWith(prefix) && (!method || r.method === method)));
      }
      if (url.pathname === "/__responses") {
        if (req.method === "DELETE") {
          canned.clear();
          return send(res, 200, { ok: true });
        }
        const spec = JSON.parse(body.toString("utf8"));
        if (typeof spec.path !== "string" || !spec.path.startsWith("/")) return send(res, 400, { error: "path must start with /" });
        canned.set(spec.path, { status: 200, headers: {}, body: "", delayMs: 0, times: Infinity, ...spec });
        return send(res, 200, { ok: true });
      }

      const text = body.toString("utf8");
      const type = String(req.headers["content-type"] ?? "");
      let json;
      if (/json/.test(type)) {
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
      }
      recorded.push({
        method: req.method,
        path: url.pathname,
        query: url.search,
        headers: req.headers,
        body: text,
        ...(json !== undefined ? { json } : {}),
        at: new Date().toISOString(),
      });

      const key = canned.has(url.pathname + url.search) ? url.pathname + url.search : url.pathname;
      const answer = canned.get(key);
      if (answer) {
        if (--answer.times <= 0) canned.delete(key);
        if (answer.delayMs) await new Promise((r) => setTimeout(r, answer.delayMs));
        return send(res, answer.status, answer.body, answer.headers);
      }

      if (req.method === "GET" || req.method === "HEAD") {
        const file = resolveFile(root, url.pathname);
        if (!file) return send(res, 404, "not found");
        const data = fs.readFileSync(file);
        res.writeHead(200, {
          "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
          "content-length": data.length,
        });
        return res.end(req.method === "HEAD" ? undefined : data);
      }
      return send(res, 200, { ok: true });
    } catch (e) {
      return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const url = `http://${host}:${address.port}`;
  return {
    url,
    port: address.port,
    /** Recorded requests whose path starts with `prefix`. */
    requests: (prefix = "") => recorded.filter((r) => r.path.startsWith(prefix)),
    reset() {
      recorded.length = 0;
      canned.clear();
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = await startFixtureServer({
    port: Number(process.env.FIXTURE_PORT || 3198),
    host: process.env.FIXTURE_HOST || "127.0.0.1",
    root: process.env.FIXTURE_ROOT || DEFAULT_ROOT,
  });
  console.log(`Fixture server on ${server.url}`);
  const stop = () => server.close().then(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
