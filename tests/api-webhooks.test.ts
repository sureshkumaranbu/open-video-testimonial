import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as createKeyRoute } from "@/app/api/admin/api-keys/route";
import { GET as adminHooks } from "@/app/api/admin/webhooks/route";
import { POST as createTestimonialRoute } from "@/app/api/v1/projects/[slug]/testimonials/route";
import { GET as listSubs, POST as subscribe } from "@/app/api/v1/webhooks/route";
import { DELETE as unsubscribe } from "@/app/api/v1/webhooks/[id]/route";
import { runDueJobs } from "@/lib/jobs";
import { createProject } from "@/lib/testimonials";
import { verifySignature } from "@/lib/webhooks";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, params, useTempDataDir } from "./helpers";

const hits: { headers: http.IncomingHttpHeaders; body: string }[] = [];
let receiver: http.Server;
let target = "";
beforeAll(async () => {
  receiver = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      hits.push({ headers: req.headers, body: Buffer.concat(chunks).toString() });
      res.end("ok");
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  target = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/zap`;
});
afterAll(() => new Promise<void>((r) => receiver.close(() => r())));

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;
beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  hits.length = 0;
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  createProject({ name: "Beta", slug: "beta" });
});
afterEach(() => {
  delete process.env.NET_GUARD_ALLOW;
  ctx.cleanup();
});

async function key(scope: "read" | "write", projectIds?: string[]) {
  const res = await createKeyRoute(
    new Request("http://localhost/api/admin/api-keys", { method: "POST", body: JSON.stringify({ name: scope, scope, projectIds }), headers: { ...adminHeaders(), "content-type": "application/json" } }),
  );
  return ((await res.json()) as { key: string }).key;
}
const call = (k: string, url: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  new Request(`http://localhost/api/v1${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { authorization: `Bearer ${k}`, "content-type": "application/json" } });

describe("INT-03 REST hooks through the API", () => {
  it("INT-03 a write key subscribes a public URL, gets signed events for its project, and unsubscribes", async () => {
    process.env.NET_GUARD_ALLOW = new URL(target).host; // the test receiver stands in for hooks.zapier.com
    const write = await key("write");
    const res = await subscribe(call(write, "/webhooks", { url: target, events: ["testimonial.created"], project: "acme" }));
    expect(res.status, await res.clone().text()).toBe(201);
    const sub = (await res.json()).data;
    expect(sub).toMatchObject({ url: target, events: ["testimonial.created"], project: "acme", secret: expect.stringMatching(/^whsec_/) });

    await createTestimonialRoute(call(write, "/projects/acme/testimonials", { name: "Ada", text: "Great", consent: true }), params({ slug: "acme" }));
    await runDueJobs();
    expect(hits).toHaveLength(1);
    expect(verifySignature(sub.secret, String(hits[0].headers["plaudit-signature"]), hits[0].body)).toBe(true);
    expect(JSON.parse(hits[0].body)).toMatchObject({ event: "testimonial.created", data: { testimonial: { author: { name: "Ada" } } } });

    // It shows in the dashboard, marked as made through the API, without its secret in the list here.
    const hooks = (await (await adminHooks(new Request("http://localhost/api/admin/webhooks", { headers: adminHeaders() }))).json()).webhooks;
    expect(hooks[0]).toMatchObject({ id: sub.id, apiKeyId: expect.any(String) });
    const listed = await (await listSubs(call(write, "/webhooks"))).json();
    expect(listed.data).toEqual([expect.not.objectContaining({ secret: expect.anything() })]);

    // Another key can't remove it; the one that made it can.
    const other = await key("write");
    expect((await unsubscribe(call(other, `/webhooks/${sub.id}`, undefined, "DELETE"), params({ id: sub.id }))).status).toBe(404);
    expect((await unsubscribe(call(write, `/webhooks/${sub.id}`, undefined, "DELETE"), params({ id: sub.id }))).status).toBe(200);
    expect((await (await listSubs(call(write, "/webhooks"))).json()).data).toEqual([]);
  });

  it("INT-03 refuses private addresses, read keys, no events, and a limited key without its project", async () => {
    const write = await key("write");
    const refused = await subscribe(call(write, "/webhooks", { url: target, events: ["testimonial.created"] }));
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe("Subscriptions must point at a public address");
    expect((await subscribe(call(write, "/webhooks", { url: "http://localhost:9/x", events: ["testimonial.created"] }))).status).toBe(400);
    expect((await subscribe(call(await key("read"), "/webhooks", { url: target, events: ["testimonial.created"] }))).status).toBe(403);
    expect((await subscribe(call(write, "/webhooks", { url: target, events: [] }))).status).toBe(400);
    const limited = await key("write", [projectId]);
    process.env.NET_GUARD_ALLOW = new URL(target).host;
    expect((await subscribe(call(limited, "/webhooks", { url: target, events: ["testimonial.created"] }))).status).toBe(400);
    expect((await subscribe(call(limited, "/webhooks", { url: target, events: ["testimonial.created"], project: "beta" }))).status).toBe(404);
    expect((await subscribe(call(limited, "/webhooks", { url: target, events: ["testimonial.created"], project: "acme" }))).status).toBe(201);
  });

  it("INT-03 a subscription whose address turns private isn't delivered to", async () => {
    process.env.NET_GUARD_ALLOW = new URL(target).host;
    const write = await key("write");
    await subscribe(call(write, "/webhooks", { url: target, events: ["testimonial.created"] }));
    delete process.env.NET_GUARD_ALLOW;
    await createTestimonialRoute(call(write, "/projects/acme/testimonials", { name: "Ada", text: "Great", consent: true }), params({ slug: "acme" }));
    await runDueJobs();
    expect(hits).toHaveLength(0);
  });
});
