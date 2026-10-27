import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as listRoute } from "@/app/api/admin/projects/[id]/customers/route";
import { GET as profileRoute, PATCH as patchRoute } from "@/app/api/admin/projects/[id]/customers/[customerId]/route";
import { POST as inviteRoute } from "@/app/api/admin/projects/[id]/customers/[customerId]/invite/route";
import { getDb, schema } from "@/db";
import { importCsv } from "@/lib/csv-import";
import { backfillCustomers, customerProfile, listCustomers } from "@/lib/customer-records";
import { insertFeedback } from "@/lib/feedback";
import { previewImport, setImportFetch, startImport } from "@/lib/importers/run";
import { runDueJobs } from "@/lib/jobs";
import { addManualTestimonial } from "@/lib/manual-add";
import { createProject, createTestimonial, getProjectById, getTestimonial } from "@/lib/testimonials";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, params, useTempDataDir } from "./helpers";

const FIX = path.resolve(__dirname, "fixtures/importers");

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;
let otherId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  otherId = createProject({ name: "Other", slug: "other" }).id;
});
afterEach(() => {
  setImportFetch(null);
  ctx.cleanup();
});

const project = () => getProjectById(projectId)!;
const customersOf = (id = projectId) => getDb().select().from(schema.customers).where(eq(schema.customers.projectId, id)).all();
const json = (body: unknown, method = "POST") => ({ method, headers: { ...adminHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function drain() {
  for (let i = 0; i < 20; i++) if ((await runDueJobs()) === 0) break;
}

describe("INBOX-12 customer records: linking", () => {
  it("INBOX-12 a CSV import links rows by email, and a row without one gets its own record", () => {
    const csv = "name,email,text\nAda,ADA@example.com,First\nAda L.,ada@example.com,Second\nGrace,,Third\n";
    expect(importCsv(project(), csv, {}).imported).toBe(3);
    const rows = customersOf();
    expect(rows).toHaveLength(2);
    const ada = rows.find((c) => c.email === "ada@example.com")!;
    expect(ada.name).toBe("Ada");
    const linked = getDb().select().from(schema.testimonials).where(eq(schema.testimonials.customerId, ada.id)).all();
    expect(linked.map((t) => t.text).sort()).toEqual(["First", "Second"]);
  });

  it("INBOX-12 a review-site import links every imported review to a customer", async () => {
    setImportFetch(async (url) => {
      const page = /customerreviews\/page=(\d+)\//.exec(url)?.[1];
      if (page === "1") return { status: 200, text: fs.readFileSync(path.join(FIX, "appstore/page1.json"), "utf8"), finalUrl: url, contentType: "application/json" };
      return { status: 404, text: "", finalUrl: url, contentType: "text/plain" };
    });
    const preview = await previewImport(projectId, "appstore", { app: "https://apps.apple.com/us/app/acme/id123456789" }, {}, { confirmOwnership: true });
    startImport(preview.run.id, preview.items.slice(0, 3).map((i) => i.id));
    await drain();
    const rows = getDb().select().from(schema.testimonials).where(eq(schema.testimonials.source, "importer:appstore")).all();
    expect(rows).toHaveLength(3);
    expect(rows.every((t) => t.customerId)).toBe(true);
  });

  it("INBOX-12 a manual add from a profile links to that customer, and a stranger's id is refused", async () => {
    const ada = createTestimonial(projectId, { name: "Ada", email: "ada@example.com", text: "Hi" });
    backfillCustomers();
    const customerId = getTestimonial(ada.id)!.customerId!;
    const added = await addManualTestimonial(project(), { name: "Ada Lovelace", text: "Again", customerId }, {});
    expect(added.customerId).toBe(customerId);
    const other = createTestimonial(otherId, { name: "Bea", email: "bea@example.com", text: "Hi" });
    backfillCustomers();
    const strangerId = getTestimonial(other.id)!.customerId!;
    await expect(addManualTestimonial(project(), { name: "Bea", text: "x", customerId: strangerId }, {})).rejects.toMatchObject({ status: 404 });
  });

  it("INBOX-12 the backfill links older rows by email and is a no-op the second time", () => {
    const a = createTestimonial(projectId, { name: "Ada", email: "ada@example.com", text: "One" });
    const b = createTestimonial(projectId, { name: "Ada", email: "Ada@Example.com", text: "Two" });
    const c = createTestimonial(projectId, { name: "Cy", text: "Three" });
    expect(backfillCustomers()).toBe(3);
    expect(backfillCustomers()).toBe(0);
    expect(getTestimonial(a.id)!.customerId).toBe(getTestimonial(b.id)!.customerId);
    expect(getTestimonial(c.id)!.customerId).not.toBe(getTestimonial(a.id)!.customerId);
    expect(customersOf()).toHaveLength(2);
  });
});

describe("INBOX-12 customer records: list and profile", () => {
  it("INBOX-12 lists customers with counts and searches by name, email or company", async () => {
    createTestimonial(projectId, { name: "Ada", email: "ada@example.com", company: "Analytical", text: "One" });
    createTestimonial(projectId, { name: "Ada", email: "ada@example.com", text: "Two" });
    createTestimonial(projectId, { name: "Grace", email: "grace@navy.example", text: "Three" });
    backfillCustomers();
    getDb().insert(schema.requests).values({ id: "r1", projectId, email: "ada@example.com", createdAt: new Date() }).run();
    const all = listCustomers(projectId);
    expect(all.total).toBe(2);
    const ada = all.items.find((c) => c.email === "ada@example.com")!;
    expect(ada).toMatchObject({ testimonials: 2, invites: 1, feedback: 0 });
    expect(listCustomers(projectId, { q: "navy" }).items.map((c) => c.name)).toEqual(["Grace"]);
    expect(listCustomers(projectId, { q: "analyt" }).items.map((c) => c.name)).toEqual(["Ada"]);
    expect(listCustomers(projectId, { q: "%" }).total).toBe(0);
    const res = await listRoute(new Request(`http://localhost/api/admin/projects/${projectId}/customers?q=grace`, { headers: adminHeaders() }), params({ id: projectId }));
    expect((await res.json()).items).toHaveLength(1);
    expect((await listRoute(new Request(`http://localhost/api/admin/projects/${projectId}/customers`), params({ id: projectId }))).status).toBe(401);
  });

  it("INBOX-12 a profile shows testimonials, feedback by link or address, invitations by address and claimed rewards", async () => {
    const t = createTestimonial(projectId, { name: "Ada", email: "ada@example.com", text: "Great" });
    backfillCustomers();
    const customerId = getTestimonial(t.id)!.customerId!;
    getDb().transaction((tx) => {
      insertFeedback(tx, projectId, [{ formId: null, customerId: null, testimonialId: null, rating: 2, text: "Slow exports", authorName: "Ada", authorEmail: "ADA@example.com" }]);
      insertFeedback(tx, projectId, [{ formId: null, customerId: null, testimonialId: null, rating: 1, text: "Someone else", authorName: "Bo", authorEmail: "bo@example.com" }]);
    });
    getDb().insert(schema.requests).values({ id: "r1", projectId, email: "ada@example.com", createdAt: new Date() }).run();
    getDb().insert(schema.requests).values({ id: "r2", projectId: otherId, email: "ada@example.com", createdAt: new Date() }).run();
    const formId = getDb().select().from(schema.forms).where(eq(schema.forms.projectId, projectId)).get()!.id;
    getDb().insert(schema.rewardCodes).values({ id: "code1", projectId, formId, code: "THANKS-1", claimedAt: new Date(), testimonialId: t.id }).run();
    getDb().insert(schema.rewardCodes).values({ id: "code2", projectId, formId, code: "UNCLAIMED" }).run();

    const p = customerProfile(project(), customerId)!;
    expect(p.testimonials.map((x) => x.id)).toEqual([t.id]);
    expect(p.feedback.map((f) => f.text)).toEqual(["Slow exports"]);
    expect(p.invites.map((i) => i.id)).toEqual(["r1"]);
    expect(p.invites[0].link).toMatch(/\?r=/);
    expect(p.rewards.map((r) => r.code)).toEqual(["THANKS-1"]);

    const res = await profileRoute(new Request("http://localhost/x", { headers: adminHeaders() }), params({ id: otherId, customerId }));
    expect(res.status).toBe(404);
  });

  it("INBOX-12 edits the record only, refuses an email another customer has, and keeps the testimonial as written", async () => {
    const t = createTestimonial(projectId, { name: "Ada", email: "ada@example.com", text: "Hi" });
    createTestimonial(projectId, { name: "Grace", email: "grace@example.com", text: "Hi" });
    backfillCustomers();
    const customerId = getTestimonial(t.id)!.customerId!;
    const url = `http://localhost/api/admin/projects/${projectId}/customers/${customerId}`;
    const ok = await patchRoute(new Request(url, json({ name: "Ada Lovelace", company: "Analytical Engines", website: "https://ada.example" }, "PATCH")), params({ id: projectId, customerId }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).customer).toMatchObject({ name: "Ada Lovelace", company: "Analytical Engines" });
    expect(getTestimonial(t.id)!.authorName).toBe("Ada");
    const clash = await patchRoute(new Request(url, json({ email: "GRACE@example.com" }, "PATCH")), params({ id: projectId, customerId }));
    expect(clash.status).toBe(409);
    const bad = await patchRoute(new Request(url, json({ website: "javascript:alert(1)" }, "PATCH")), params({ id: projectId, customerId }));
    expect(bad.status).toBe(400);
    const big = await patchRoute(new Request(url, json({ name: "x".repeat(70_000) }, "PATCH")), params({ id: projectId, customerId }));
    expect(big.status).toBe(413);
  });

  it("INBOX-12 invite to a form creates one personal request; a second open one is refused", async () => {
    const t = createTestimonial(projectId, { name: "Ada", email: "ada@example.com", text: "Hi" });
    const nameOnly = createTestimonial(projectId, { name: "Nobody", text: "Hi" });
    backfillCustomers();
    const customerId = getTestimonial(t.id)!.customerId!;
    const invite = (id: string, body: unknown) =>
      inviteRoute(new Request(`http://localhost/api/admin/projects/${projectId}/customers/${id}/invite`, json(body)), params({ id: projectId, customerId: id }));
    const first = await invite(customerId, { formId: null, send: false });
    expect(first.status).toBe(201);
    expect((await first.json()).request.link).toContain("/c/acme?r=");
    expect(getDb().select().from(schema.requests).where(eq(schema.requests.projectId, projectId)).all()).toHaveLength(1);
    expect((await invite(customerId, { formId: null, send: false })).status).toBe(409);
    expect((await invite(getTestimonial(nameOnly.id)!.customerId!, { send: false })).status).toBe(400);
    // Email isn't set up in tests.
    expect((await invite(customerId, { send: true })).status).toBe(409);
    expect((await invite(customerId, { formId: "nope", send: false })).status).toBe(404);
  });
});
