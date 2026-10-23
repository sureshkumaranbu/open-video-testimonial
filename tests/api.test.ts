import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as createKeyRoute } from "@/app/api/admin/api-keys/route";
import { DELETE as revokeRoute } from "@/app/api/admin/api-keys/[id]/route";
import { POST as createHookRoute } from "@/app/api/admin/webhooks/route";
import { PATCH as patchHook } from "@/app/api/admin/webhooks/[id]/route";
import { POST as testHook } from "@/app/api/admin/webhooks/[id]/test/route";
import { GET as deliveriesRoute } from "@/app/api/admin/webhooks/[id]/deliveries/route";
import { POST as redeliverRoute } from "@/app/api/admin/webhook-deliveries/[id]/redeliver/route";
import { POST as submit } from "@/app/api/projects/[slug]/testimonials/route";
import { GET as openapi } from "@/app/api/v1/openapi.json/route";
import { GET as listProjectsRoute } from "@/app/api/v1/projects/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/projects/[slug]/testimonials/route";
import { DELETE as deleteRoute, GET as getRoute, PATCH as patchRoute } from "@/app/api/v1/testimonials/[id]/route";
import { POST as withdraw } from "@/app/api/withdraw/[token]/route";
import { runDueJobs } from "@/lib/jobs";
import { listConsentEvents } from "@/lib/consent";
import { createProject, getTestimonial } from "@/lib/testimonials";
import { verifySignature } from "@/lib/webhooks";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, params, submissionForm, submitRequest, useTempDataDir } from "./helpers";

// ------------------------------------------------------------ a receiver

type Hit = { headers: http.IncomingHttpHeaders; body: string };
const hits: Hit[] = [];
let respondWith = 200;
let receiver: http.Server;
let receiverUrl = "";

beforeAll(async () => {
  receiver = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      hits.push({ headers: req.headers, body: Buffer.concat(chunks).toString() });
      if (respondWith === 302) res.writeHead(302, { location: "http://example.com/" });
      else res.writeHead(respondWith, { "content-type": "text/plain" });
      res.end(respondWith < 300 ? "thanks" : "nope");
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
});
afterAll(() => new Promise<void>((r) => receiver.close(() => r())));

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  hits.length = 0;
  respondWith = 200;
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => ctx.cleanup());

const admin = (url: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  new Request(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...adminHeaders(), "content-type": "application/json" },
  });

const withKey = (key: string, url: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  new Request(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  });

async function newKey(scope: "read" | "write") {
  const res = await createKeyRoute(admin("/api/admin/api-keys", { name: `${scope} key`, scope }));
  expect(res.status).toBe(201);
  return (await res.json()) as { key: string; id: string; prefix: string };
}

async function newHook(body: Record<string, unknown> = {}) {
  const res = await createHookRoute(admin("/api/admin/webhooks", { url: receiverUrl, ...body }));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()).webhook as { id: string; secret: string };
}

async function customerSubmits(name = "Ada") {
  const res = await submit(
    submitRequest("acme", submissionForm({ name, email: "ada@example.com", text: "Great", consent: "on" })),
    params({ slug: "acme" }),
  );
  return (await res.json()) as { id: string; withdrawUrl: string };
}

/** Independent check of the documented signature scheme. */
function independentVerify(secret: string, header: string, body: string) {
  const [t, v1] = header.split(",").map((p) => p.split("=")[1]);
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return v1 === expected && Math.abs(Date.now() / 1000 - Number(t)) < 300;
}

describe("REST API", () => {
  it("needs a valid, unrevoked key", async () => {
    const missing = await listProjectsRoute(new Request("http://localhost/api/v1/projects"));
    expect(missing.status).toBe(401);
    expect((await missing.json()).error).toMatch(/^Missing API key/);
    // A malformed key says it's invalid, not missing.
    const malformed = await listProjectsRoute(withKey("not-a-plaudit-key", "/api/v1/projects"));
    expect(malformed.status).toBe(401);
    expect((await malformed.json()).error).toMatch(/^Invalid API key/);
    const unknown = await listProjectsRoute(withKey("plk_wrongwrongwrongwrongwrong", "/api/v1/projects"));
    expect(unknown.status).toBe(401);
    expect((await unknown.json()).error).toBe("Invalid or revoked API key");
    const { key, id, prefix } = await newKey("read");
    expect(key).toMatch(/^plk_[\w-]{43}$/);
    expect(prefix).toBe(key.slice(0, 12));
    const ok = await listProjectsRoute(withKey(key, "/api/v1/projects"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).data[0]).toMatchObject({
      slug: "acme",
      collectUrl: "http://localhost:3000/c/acme",
      counts: { pending: 0, approved: 0, rejected: 0 },
    });
    await revokeRoute(admin(`/api/admin/api-keys/${id}`, undefined, "DELETE"), params({ id }));
    expect((await listProjectsRoute(withKey(key, "/api/v1/projects"))).status).toBe(401);
  });

  it("lists, filters and pages testimonials with private fields and the transcript", async () => {
    const { key } = await newKey("read");
    for (const n of ["A", "B", "C"]) await customerSubmits(n);
    const res = await listRoute(withKey(key, "/api/v1/projects/acme/testimonials?limit=2"), params({ slug: "acme" }));
    const body = await res.json();
    expect(body.pagination).toEqual({ total: 3, limit: 2, offset: 0, nextOffset: 2 });
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      status: "pending",
      transcript: null,
      author: { name: expect.any(String), email: "ada@example.com" },
      consent: { scopes: ["website"], editedAfterConsent: false, withdrawnAt: null },
      source: "form",
    });
    const page2 = await (
      await listRoute(withKey(key, "/api/v1/projects/acme/testimonials?limit=2&offset=2"), params({ slug: "acme" }))
    ).json();
    expect(page2.data).toHaveLength(1);
    expect(page2.pagination.nextOffset).toBeNull();
    expect((await listRoute(withKey(key, "/api/v1/projects/acme/testimonials?status=bogus"), params({ slug: "acme" }))).status).toBe(400);
    // Out-of-range or malformed paging is an error, not silently clamped.
    for (const query of ["limit=1000", "limit=0", "limit=abc", "limit=2.5", "offset=-1", "offset=x"]) {
      const bad = await listRoute(withKey(key, `/api/v1/projects/acme/testimonials?${query}`), params({ slug: "acme" }));
      expect(bad.status, query).toBe(400);
      expect((await bad.json()).error, query).toMatch(/^(limit|offset) must be/);
    }
    const max = await listRoute(withKey(key, "/api/v1/projects/acme/testimonials?limit=100"), params({ slug: "acme" }));
    expect((await max.json()).pagination.limit).toBe(100);
    expect((await listRoute(withKey(key, "/api/v1/projects/nope/testimonials"), params({ slug: "nope" }))).status).toBe(404);
  });

  it("read keys can't write; write keys can create, moderate, edit and delete", async () => {
    const read = await newKey("read");
    const write = await newKey("write");
    const payload = { name: "Grace", text: "Shipped it.", rating: 5, tags: ["Home"], status: "approved", consent: true };
    expect((await createRoute(withKey(read.key, "/api/v1/projects/acme/testimonials", payload), params({ slug: "acme" }))).status).toBe(403);
    const missingConsent = await createRoute(
      withKey(write.key, "/api/v1/projects/acme/testimonials", { ...payload, consent: undefined }),
      params({ slug: "acme" }),
    );
    expect(missingConsent.status).toBe(400);
    expect((await missingConsent.json()).error).toMatch(/consent: true/);

    const created = await createRoute(withKey(write.key, "/api/v1/projects/acme/testimonials", payload), params({ slug: "acme" }));
    expect(created.status).toBe(201);
    const t = (await created.json()).data;
    expect(t).toMatchObject({ status: "approved", source: "api", tags: ["home"], rating: 5 });
    expect(listConsentEvents(t.id)[0]).toMatchObject({ type: "granted", actor: "api" });

    const patched = await patchRoute(withKey(write.key, `/api/v1/testimonials/${t.id}`, { text: "Shipped it fast." }, "PATCH"), params({ id: t.id }));
    expect((await patched.json()).data).toMatchObject({ text: "Shipped it fast.", consent: { editedAfterConsent: true } });
    expect(listConsentEvents(t.id).at(-1)).toMatchObject({ type: "edited", actor: "api" });

    expect((await getRoute(withKey(read.key, `/api/v1/testimonials/${t.id}`), params({ id: t.id }))).status).toBe(200);
    expect((await deleteRoute(withKey(read.key, `/api/v1/testimonials/${t.id}`, undefined, "DELETE"), params({ id: t.id }))).status).toBe(403);
    expect((await deleteRoute(withKey(write.key, `/api/v1/testimonials/${t.id}`, undefined, "DELETE"), params({ id: t.id }))).status).toBe(200);
    expect(getTestimonial(t.id)).toBeNull();
  });

  it("refuses to re-publish a withdrawn testimonial", async () => {
    const write = await newKey("write");
    const { id, withdrawUrl } = await customerSubmits();
    const token = withdrawUrl.split("/w/")[1];
    await withdraw(new Request(`http://localhost/api/withdraw/${token}`, { method: "POST" }), params({ token }));
    const res = await patchRoute(withKey(write.key, `/api/v1/testimonials/${id}`, { status: "approved" }, "PATCH"), params({ id }));
    expect(res.status).toBe(409);
  });

  it("shows withdrawn testimonials as withdrawn, not rejected", async () => {
    const { key } = await newKey("read");
    const { id, withdrawUrl } = await customerSubmits("Withdrawer");
    await customerSubmits("Stayer");
    const token = withdrawUrl.split("/w/")[1];
    await withdraw(new Request(`http://localhost/api/withdraw/${token}`, { method: "POST" }), params({ token }));
    const one = await (await getRoute(withKey(key, `/api/v1/testimonials/${id}`), params({ id }))).json();
    expect(one.data).toMatchObject({ status: "withdrawn", consent: { withdrawnAt: expect.any(String) } });
    const list = async (status: string) =>
      (await (await listRoute(withKey(key, `/api/v1/projects/acme/testimonials?status=${status}`), params({ slug: "acme" }))).json())
        .data as { id: string }[];
    expect((await list("withdrawn")).map((t) => t.id)).toEqual([id]);
    expect(await list("rejected")).toEqual([]);
    expect(await list("pending")).toHaveLength(1);
  });

  it("publishes an OpenAPI 3.1 description", async () => {
    const spec = await (await openapi()).json();
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toEqual(["/projects", "/projects/{slug}/testimonials", "/testimonials/{id}"]);
    expect(Object.keys(spec.webhooks)).toContain("testimonial.approved");
    expect(spec.servers[0].url).toBe("http://localhost:3000/api/v1");
  });
});

describe("webhooks", () => {
  it("delivers signed events for the testimonial lifecycle", async () => {
    const hook = await newHook();
    const { id, withdrawUrl } = await customerSubmits();
    await runDueJobs();
    const write = await newKey("write");
    await patchRoute(withKey(write.key, `/api/v1/testimonials/${id}`, { status: "approved" }, "PATCH"), params({ id }));
    await runDueJobs();
    const token = withdrawUrl.split("/w/")[1];
    await withdraw(new Request(`http://localhost/api/withdraw/${token}`, { method: "POST" }), params({ token }));
    await runDueJobs();

    expect(hits.map((h) => h.headers["plaudit-event"])).toEqual([
      "testimonial.created",
      "testimonial.approved",
      "consent.withdrawn",
    ]);
    for (const hit of hits) {
      const signature = hit.headers["plaudit-signature"] as string;
      expect(independentVerify(hook.secret, signature, hit.body)).toBe(true);
      expect(verifySignature(hook.secret, signature, hit.body)).toBe(true);
      expect(verifySignature(hook.secret, signature, hit.body.replace("Ada", "Eve"))).toBe(false);
      expect(verifySignature("whsec_other", signature, hit.body)).toBe(false);
      expect(hit.headers["content-type"]).toBe("application/json");
      expect(hit.headers["user-agent"]).toBe("Plaudit-Webhooks/1");
    }
    const created = JSON.parse(hits[0].body);
    expect(created).toMatchObject({
      event: "testimonial.created",
      id: hits[0].headers["plaudit-delivery"],
      project: { slug: "acme" },
      data: { testimonial: { id, author: { name: "Ada", email: "ada@example.com" }, transcript: null } },
    });
    expect(JSON.parse(hits[2].body).data.testimonial.consent.withdrawnAt).not.toBeNull();
  });

  it("rejects old signatures (replay protection)", () => {
    const secret = "whsec_test";
    const body = '{"a":1}';
    const t = Math.floor(Date.now() / 1000) - 600;
    const v1 = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    expect(verifySignature(secret, `t=${t},v1=${v1}`, body)).toBe(false);
    expect(verifySignature(secret, `t=${t},v1=${v1}`, body, 900)).toBe(true);
  });

  it("filters by event and project, and skips paused endpoints", async () => {
    const other = createProject({ name: "Other", slug: "other" });
    await newHook({ events: ["testimonial.approved"] });
    await newHook({ projectId: other.id });
    const paused = await newHook();
    await patchHook(admin(`/api/admin/webhooks/${paused.id}`, { active: false }, "PATCH"), params({ id: paused.id }));
    await customerSubmits();
    await runDueJobs();
    expect(hits).toHaveLength(0);
  });

  it("retries failures with backoff, logs every attempt, and can redeliver", async () => {
    const hook = await newHook();
    respondWith = 500;
    const ping = await testHook(admin(`/api/admin/webhooks/${hook.id}/test`, {}), params({ id: hook.id }));
    expect(ping.status).toBe(202);
    await runDueJobs();
    const deliveries = async () =>
      (await (await deliveriesRoute(admin(`/api/admin/webhooks/${hook.id}/deliveries`), params({ id: hook.id }))).json()).deliveries;
    let [d] = await deliveries();
    expect(d).toMatchObject({ event: "ping", status: "pending", attempts: 1, responseStatus: 500, error: "HTTP 500" });

    respondWith = 200;
    await runDueJobs({ now: () => new Date(Date.now() + 31_000) });
    [d] = await deliveries();
    expect(d).toMatchObject({ status: "success", attempts: 2, responseStatus: 200, responseBody: "thanks", error: null });
    expect(hits).toHaveLength(2);
    expect(JSON.parse(hits[1].body)).toMatchObject({ event: "ping", data: { message: expect.any(String) } });

    await redeliverRoute(admin(`/api/admin/webhook-deliveries/${d.id}/redeliver`, {}), params({ id: d.id }));
    await runDueJobs();
    expect(hits).toHaveLength(3);
    expect(hits[2].headers["plaudit-delivery"]).toBe(d.id);
  });

  it("gives up after six attempts and never follows redirects", async () => {
    const hook = await newHook();
    respondWith = 302;
    await testHook(admin(`/api/admin/webhooks/${hook.id}/test`, {}), params({ id: hook.id }));
    for (let i = 1; i <= 7; i++) await runDueJobs({ now: () => new Date(Date.now() + i * 7 * 60 * 60 * 1000) });
    const [d] = (await (await deliveriesRoute(admin(`/api/admin/webhooks/${hook.id}/deliveries`), params({ id: hook.id }))).json()).deliveries;
    expect(d).toMatchObject({ status: "failed", attempts: 6, responseStatus: 302 });
    expect(d.error).toMatch(/Redirects aren't followed/);
    expect(hits).toHaveLength(6);
  });

  it("pausing or rotating keeps the endpoint's project and events", async () => {
    const other = createProject({ name: "Other", slug: "other" });
    const hook = await newHook({ projectId: other.id, events: ["testimonial.approved"] });
    const patch = async (body: unknown) =>
      (await (await patchHook(admin(`/api/admin/webhooks/${hook.id}`, body, "PATCH"), params({ id: hook.id }))).json()).webhook;
    let w = await patch({ active: false });
    expect(w).toMatchObject({ projectId: other.id, events: '["testimonial.approved"]', active: false });
    w = await patch({ rotateSecret: true });
    expect(w).toMatchObject({ projectId: other.id, events: '["testimonial.approved"]', active: false });
    expect(w.secret).not.toBe(hook.secret);
    const bad = await patchHook(admin(`/api/admin/webhooks/${hook.id}`, { projectId: "nope" }, "PATCH"), params({ id: hook.id }));
    expect(bad.status).toBe(400);
  });

  it("doesn't send deliveries queued before the endpoint was paused", async () => {
    const hook = await newHook();
    await customerSubmits();
    await patchHook(admin(`/api/admin/webhooks/${hook.id}`, { active: false }, "PATCH"), params({ id: hook.id }));
    await runDueJobs();
    expect(hits).toHaveLength(0);
    const [d] = (await (await deliveriesRoute(admin(`/api/admin/webhooks/${hook.id}/deliveries`), params({ id: hook.id }))).json()).deliveries;
    expect(d).toMatchObject({ status: "failed", error: "Not sent: the webhook is paused" });
  });

  it("only accepts http(s) endpoints", async () => {
    for (const url of ["ftp://example.com/x", "javascript:alert(1)", "not a url"]) {
      expect((await createHookRoute(admin("/api/admin/webhooks", { url }))).status).toBe(400);
    }
  });
});
