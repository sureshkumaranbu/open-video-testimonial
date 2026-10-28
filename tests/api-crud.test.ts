import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createKeyRoute } from "@/app/api/admin/api-keys/route";
import { GET as objectAnalytics } from "@/app/api/v1/analytics/[type]/[id]/route";
import { GET as getCampaignRoute, PATCH as patchCampaign, DELETE as deleteCampaignRoute } from "@/app/api/v1/campaigns/[id]/route";
import { GET as listRecipients, POST as addRecipientsRoute } from "@/app/api/v1/campaigns/[id]/recipients/route";
import { GET as getCustomerRoute } from "@/app/api/v1/customers/[id]/route";
import { DELETE as deleteFormRoute, GET as getFormRoute, PATCH as patchForm } from "@/app/api/v1/forms/[id]/route";
import { GET as openapi } from "@/app/api/v1/openapi.json/route";
import { GET as projectAnalytics } from "@/app/api/v1/projects/[slug]/analytics/route";
import { GET as listCampaignsRoute, POST as createCampaignRoute } from "@/app/api/v1/projects/[slug]/campaigns/route";
import { GET as listCustomersRoute } from "@/app/api/v1/projects/[slug]/customers/route";
import { GET as listFeedbackRoute } from "@/app/api/v1/projects/[slug]/feedback/route";
import { GET as listFormsRoute, POST as createFormRoute } from "@/app/api/v1/projects/[slug]/forms/route";
import { DELETE as deleteTagRoute, GET as listTagsRoute, PATCH as patchTags } from "@/app/api/v1/projects/[slug]/tags/route";
import { GET as listWallsRoute, POST as createWallRoute } from "@/app/api/v1/projects/[slug]/walls/route";
import { GET as listWidgetsRoute, POST as createWidgetRoute } from "@/app/api/v1/projects/[slug]/widgets/route";
import { GET as listProjectsRoute } from "@/app/api/v1/projects/route";
import { DELETE as deleteWallRoute, GET as getWallRoute, PATCH as patchWall } from "@/app/api/v1/walls/[id]/route";
import { DELETE as deleteWidgetRoute, GET as getWidgetRoute, PATCH as patchWidget } from "@/app/api/v1/widgets/[id]/route";
import { getDb } from "@/db";
import { recordEvent, resetCollectState } from "@/lib/analytics";
import { getCampaign, regenerateWebhook } from "@/lib/campaigns";
import { upsertCustomer } from "@/lib/customers";
import { insertFeedback } from "@/lib/feedback";
import { createProject, createTestimonial, updateTestimonial } from "@/lib/testimonials";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;
let read: string;
let write: string;

async function newKey(scope: "read" | "write") {
  const res = await createKeyRoute(
    new Request("http://localhost/api/admin/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: `${scope} key`, scope }),
      headers: { ...adminHeaders(), "content-type": "application/json" },
    }),
  );
  return ((await res.json()) as { key: string }).key;
}

const call = (key: string, url: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  new Request(`http://localhost/api/v1${url}`, {
    method,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  });

const VARS = ["PLAUDIT_FEATURES", "ANALYTICS", "MAIL_OUTBOX"];

beforeEach(async () => {
  ctx = useTempDataDir();
  registerJobs();
  resetCollectState();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  read = await newKey("read");
  write = await newKey("write");
});
afterEach(() => {
  for (const k of VARS) delete process.env[k];
  ctx.cleanup();
});

const slug = params({ slug: "acme" });
const json = async (res: Response | Promise<Response>) => {
  const r = await res;
  return { status: r.status, body: (await r.json()) as Record<string, any> };
};

describe("API-01 the api2 flag", () => {
  it("API-01 with api2 off, the new paths answer 404 and the API is exactly what it was", async () => {
    process.env.PLAUDIT_FEATURES = "forms,widgets,walls,campaigns,analytics";
    expect((await listFormsRoute(call(read, "/projects/acme/forms"), slug)).status).toBe(404);
    expect((await listWidgetsRoute(call(read, "/projects/acme/widgets"), slug)).status).toBe(404);
    expect((await projectAnalytics(call(read, "/projects/acme/analytics"), slug)).status).toBe(404);
    expect((await listProjectsRoute(call(read, "/projects"))).status).toBe(200);
    const spec = await (await openapi()).json();
    expect(Object.keys(spec.paths)).toEqual(["/projects", "/projects/{slug}/testimonials", "/testimonials/{id}", "/invites"]);
    expect(spec.components.schemas.Form).toBeUndefined();
  });

  it("API-01 with api2 on, openapi.json lists every new path", async () => {
    const spec = await (await openapi()).json();
    expect(Object.keys(spec.paths)).toEqual([
      "/projects",
      "/projects/{slug}/testimonials",
      "/testimonials/{id}",
      "/invites",
      "/projects/{slug}/forms",
      "/forms/{id}",
      "/projects/{slug}/widgets",
      "/widgets/{id}",
      "/projects/{slug}/walls",
      "/walls/{id}",
      "/projects/{slug}/campaigns",
      "/campaigns/{id}",
      "/campaigns/{id}/recipients",
      "/projects/{slug}/tags",
      "/projects/{slug}/customers",
      "/customers/{id}",
      "/projects/{slug}/feedback",
      "/projects/{slug}/analytics",
      "/analytics/{type}/{id}",
      "/webhooks",
      "/webhooks/{id}",
    ]);
    // Every $ref points at a schema that exists.
    const refs = [...JSON.stringify(spec).matchAll(/"#\/components\/schemas\/(\w+)"/g)].map((m) => m[1]);
    for (const r of new Set(refs)) expect(spec.components.schemas[r], r).toBeDefined();
  });

  it("API-01 needs a key, and a write key to change anything", async () => {
    const anon = new Request("http://localhost/api/v1/projects/acme/forms");
    expect((await listFormsRoute(anon, slug)).status).toBe(401);
    const res = await json(createFormRoute(call(read, "/projects/acme/forms", { name: "Nope" }), slug));
    expect(res).toEqual({ status: 403, body: { error: "This API key is read-only" } });
    expect((await listFormsRoute(call(read, "/projects/nope/forms"), params({ slug: "nope" }))).status).toBe(404);
  });

  it("API-01 caps request bodies and refuses what isn't JSON", async () => {
    const big = JSON.stringify({ name: "x".repeat(20 * 1024) });
    expect((await createFormRoute(call(write, "/projects/acme/forms", big), slug)).status).toBe(413);
    expect((await json(createFormRoute(call(write, "/projects/acme/forms", "{nope"), slug))).body).toEqual({ error: "The body isn't valid JSON" });
    const huge = JSON.stringify({ config: { css: "a".repeat(300 * 1024) } });
    const w = await json(createWidgetRoute(call(write, "/projects/acme/widgets", { name: "Home" }), slug));
    expect((await patchWidget(call(write, `/widgets/${w.body.data.id}`, huge, "PATCH"), params({ id: w.body.data.id }))).status).toBe(413);
  });
});

describe("API-01 forms", () => {
  it("API-01 lists, creates from a template, edits, re-links, makes default and deletes forms as the builder does", async () => {
    const list = await json(listFormsRoute(call(read, "/projects/acme/forms"), slug));
    expect(list.body.data).toHaveLength(1);
    const def = list.body.data[0];
    expect(def).toMatchObject({ isDefault: true, layout: "classic", links: { hosted: "http://localhost:3000/c/acme" } });

    const made = await json(createFormRoute(call(write, "/projects/acme/forms", { name: "Course feedback", template: "course" }), slug));
    expect(made.status).toBe(201);
    const id = made.body.data.id as string;
    expect(made.body.data).toMatchObject({ layout: "steps", template: "course", status: "live" });

    const bad = await json(patchForm(call(write, `/forms/${id}`, { language: "xx" }, "PATCH"), params({ id })));
    expect(bad.status).toBe(400);
    const edited = await json(patchForm(call(write, `/forms/${id}`, { name: "Students", status: "paused", slug: "students" }, "PATCH"), params({ id })));
    expect(edited.body.data).toMatchObject({ name: "Students", status: "paused", slug: "students", links: { hosted: "http://localhost:3000/f/acme/students" } });

    expect((await json(deleteFormRoute(call(write, `/forms/${def.id}`, undefined, "DELETE"), params({ id: def.id })))).status).toBe(409);
    await patchForm(call(write, `/forms/${id}`, { isDefault: true }, "PATCH"), params({ id }));
    expect((await json(getFormRoute(call(read, `/forms/${id}`), params({ id })))).body.data.isDefault).toBe(true);
    expect((await deleteFormRoute(call(write, `/forms/${def.id}`, undefined, "DELETE"), params({ id: def.id }))).status).toBe(200);
    expect((await getFormRoute(call(read, `/forms/${def.id}`), params({ id: def.id }))).status).toBe(404);
  });
});

describe("API-01 widgets and walls", () => {
  it("API-01 widgets: create with embed snippets, a form from another project is refused, edit and delete", async () => {
    const other = createProject({ name: "Other", slug: "other" });
    const otherForm = (await json(listFormsRoute(call(read, "/projects/other/forms"), params({ slug: "other" })))).body.data[0].id;
    expect(other.id).not.toBe(projectId);

    const made = await json(createWidgetRoute(call(write, "/projects/acme/widgets", { name: "Pricing", layout: "carousel" }), slug));
    expect(made.status).toBe(201);
    const w = made.body.data;
    expect(w.id).toMatch(/^w_[a-z0-9]{12}$/);
    expect(w.embed.script).toBe(`<script src="http://localhost:3000/widget.js" data-widget="${w.id}" async></script>`);
    expect(w.embed.html).toBe(`http://localhost:3000/api/widget/${w.id}/html`);

    const refused = await json(patchWidget(call(write, `/widgets/${w.id}`, { connectedFormId: otherForm }, "PATCH"), params({ id: w.id })));
    expect(refused.status).toBe(400);
    const renamed = await json(patchWidget(call(write, `/widgets/${w.id}`, { name: "Pricing page", placement: "pricing" }, "PATCH"), params({ id: w.id })));
    expect(renamed.body.data).toMatchObject({ name: "Pricing page", placement: "pricing", layout: "carousel" });
    expect((await json(listWidgetsRoute(call(read, "/projects/acme/widgets"), slug))).body.data).toHaveLength(1);
    expect((await deleteWidgetRoute(call(write, `/widgets/${w.id}`, undefined, "DELETE"), params({ id: w.id }))).status).toBe(200);
    expect((await getWidgetRoute(call(read, `/widgets/${w.id}`), params({ id: w.id }))).status).toBe(404);
  });

  it("API-01 walls: a draft, published as the main wall, re-linked, then deleted", async () => {
    const made = await json(createWallRoute(call(write, "/projects/acme/walls", { name: "Love", theme: "night" }), slug));
    expect(made.status).toBe(201);
    const id = made.body.data.id as string;
    expect(made.body.data).toMatchObject({ published: false, theme: "night", url: "http://localhost:3000/wall/acme/love" });
    const live = await json(patchWall(call(write, `/walls/${id}`, { published: true, main: true, slug: "praise" }, "PATCH"), params({ id })));
    expect(live.body.data).toMatchObject({ published: true, isMain: true, slug: "praise", publicUrl: "http://localhost:3000/wall/acme" });
    expect((await patchWall(call(write, `/walls/${id}`, { theme: "neon" }, "PATCH"), params({ id }))).status).toBe(400);
    expect((await json(listWallsRoute(call(read, "/projects/acme/walls"), slug))).body.data).toHaveLength(1);
    expect((await deleteWallRoute(call(write, `/walls/${id}`, undefined, "DELETE"), params({ id }))).status).toBe(200);
    expect((await getWallRoute(call(read, `/walls/${id}`), params({ id }))).status).toBe(404);
  });
});

describe("API-01 campaigns", () => {
  it("API-01 creates, words, fills, starts and pauses a campaign; the incoming webhook stays secret", async () => {
    const made = await json(createCampaignRoute(call(write, "/projects/acme/campaigns", { name: "Spring" }), slug));
    expect(made.status).toBe(201);
    const id = made.body.data.id as string;
    expect(made.body.data).toMatchObject({ status: "draft", reminders: [3, 7], webhook: { on: false } });

    const { token } = regenerateWebhook(getCampaign(id)!);
    const got = await getCampaignRoute(call(read, `/campaigns/${id}`), params({ id }));
    const text = await got.text();
    expect(JSON.parse(text).data.webhook).toEqual({ on: true });
    expect(text).not.toContain(token.slice(0, 10));
    expect(text).not.toMatch(/tokenHash|cwh_/);

    expect((await patchCampaign(call(write, `/campaigns/${id}`, { reminders: [1, 2, 3, 4] }, "PATCH"), params({ id }))).status).toBe(400);
    const worded = await json(patchCampaign(call(write, `/campaigns/${id}`, { subject: "A favour, {{first_name}}?", reminders: [5] }, "PATCH"), params({ id })));
    expect(worded.body.data).toMatchObject({ subject: "A favour, {{first_name}}?", reminders: [5] });

    const added = await json(
      addRecipientsRoute(call(write, `/campaigns/${id}/recipients`, { source: "paste", text: "Ada, ada@example.com, Engines\nnot-an-email\nAda, ada@example.com" }), params({ id })),
    );
    expect(added.status).toBe(201);
    expect(added.body.data.map((r: { email: string }) => r.email)).toEqual(["ada@example.com"]);
    expect(added.body.skipped.map((s: { reason: string }) => s.reason)).toEqual(["invalid", "duplicate"]);

    // Without email set up, starting is refused as in the dashboard.
    expect((await json(patchCampaign(call(write, `/campaigns/${id}`, { status: "active" }, "PATCH"), params({ id })))).status).toBe(409);
    process.env.MAIL_OUTBOX = "true";
    const started = await json(patchCampaign(call(write, `/campaigns/${id}`, { status: "active" }, "PATCH"), params({ id })));
    expect(started.body.data).toMatchObject({ status: "active", funnel: { recipients: 1, queued: 1 } });
    const paused = await json(patchCampaign(call(write, `/campaigns/${id}`, { status: "paused" }, "PATCH"), params({ id })));
    expect(paused.body.data.status).toBe("paused");

    const recipients = await json(listRecipients(call(read, `/campaigns/${id}/recipients?limit=1`), params({ id })));
    expect(recipients.body.pagination).toEqual({ total: 1, limit: 1, offset: 0, nextOffset: null });
    expect(recipients.body.data[0]).toMatchObject({ email: "ada@example.com", emailStatus: "queued" });

    expect((await json(listCampaignsRoute(call(read, "/projects/acme/campaigns"), slug))).body.data).toHaveLength(1);
    expect((await deleteCampaignRoute(call(write, `/campaigns/${id}`, undefined, "DELETE"), params({ id }))).status).toBe(200);
    expect((await getCampaignRoute(call(read, `/campaigns/${id}`), params({ id }))).status).toBe(404);
  });
});

describe("API-01 tags, customers and feedback", () => {
  it("API-01 tags: list with counts, rename, merge and delete", async () => {
    const t = createTestimonial(projectId, { name: "Ada", text: "Great" }, { source: "api" });
    updateTestimonial(t.id, { tags: ["sales", "homepage"] }, { actor: "api" });
    expect((await json(listTagsRoute(call(read, "/projects/acme/tags"), slug))).body.data).toEqual([
      { name: "homepage", count: 1 },
      { name: "sales", count: 1 },
    ]);
    const renamed = await json(patchTags(call(write, "/projects/acme/tags", { action: "rename", from: "sales", to: "deals" }, "PATCH"), slug));
    expect(renamed.body.data.map((x: { name: string }) => x.name)).toEqual(["deals", "homepage"]);
    const merged = await json(patchTags(call(write, "/projects/acme/tags", { action: "merge", from: ["deals"], into: "homepage" }, "PATCH"), slug));
    expect(merged.body.data).toEqual([{ name: "homepage", count: 1 }]);
    expect((await deleteTagRoute(call(write, "/projects/acme/tags", undefined, "DELETE"), slug)).status).toBe(400);
    const gone = await json(deleteTagRoute(call(write, "/projects/acme/tags?name=homepage", undefined, "DELETE"), slug));
    expect(gone.body.data).toEqual([]);
  });

  it("API-01 customers and private feedback are readable, paged and scoped to the project", async () => {
    const ada = upsertCustomer(projectId, { email: "Ada@Example.com", name: "Ada", company: "Engines" })!;
    upsertCustomer(projectId, { email: "bob@example.com", name: "Bob" });
    getDb().transaction((tx) =>
      insertFeedback(tx, projectId, [{ formId: null, customerId: ada.id, testimonialId: null, rating: 2, text: "Slow support", authorName: "Ada", authorEmail: "ada@example.com" }], "low-rating"),
    );
    const page = await json(listCustomersRoute(call(read, "/projects/acme/customers?limit=1"), slug));
    expect(page.body.data[0]).toMatchObject({ name: "Ada", email: "ada@example.com", company: "Engines" });
    expect(page.body.pagination).toEqual({ total: 2, limit: 1, offset: 0, nextOffset: 1 });
    const byEmail = await json(listCustomersRoute(call(read, "/projects/acme/customers?email=BOB@example.com"), slug));
    expect(byEmail.body.data.map((c: { name: string }) => c.name)).toEqual(["Bob"]);
    expect((await listCustomersRoute(call(read, "/projects/acme/customers?limit=500"), slug)).status).toBe(400);
    expect((await json(getCustomerRoute(call(read, `/customers/${ada.id}`), params({ id: ada.id })))).body.data.id).toBe(ada.id);
    expect((await getCustomerRoute(call(read, "/customers/nope"), params({ id: "nope" }))).status).toBe(404);

    const fb = await json(listFeedbackRoute(call(read, "/projects/acme/feedback"), slug));
    expect(fb.body.data).toEqual([
      expect.objectContaining({ source: "low-rating", rating: 2, text: "Slow support", customerId: ada.id, author: { name: "Ada", email: "ada@example.com" } }),
    ]);
    createProject({ name: "Other", slug: "other" });
    expect((await json(listFeedbackRoute(call(read, "/projects/other/feedback"), params({ slug: "other" })))).body.data).toEqual([]);
  });
});

describe("API-02 analytics read", () => {
  it("API-02 a project's numbers over ?from=&to=, and one widget's", async () => {
    const w = (await json(createWidgetRoute(call(write, "/projects/acme/widgets", { name: "Home" }), slug))).body.data;
    for (const ip of ["203.0.113.1", "203.0.113.2"]) recordEvent({ projectId, type: "widget", id: w.id, metric: "view", dim: "/pricing", ip, ua: "test" });
    const today = new Date().toISOString().slice(0, 10);

    const report = await json(projectAnalytics(call(read, `/projects/acme/analytics?from=${today}&to=${today}`), slug));
    expect(report.status).toBe(200);
    expect(report.body.data.range).toEqual({ from: today, to: today });
    expect(report.body.data.tables.widgets[0]).toMatchObject({ id: w.id, views: 2 });

    const one = await json(objectAnalytics(call(read, `/analytics/widget/${w.id}?from=${today}`), params({ type: "widget", id: w.id })));
    expect(one.body.data).toMatchObject({ type: "widget", id: w.id, current: { views: 2, visitors: 2 } });
    expect(one.body.data.topPages[0]).toMatchObject({ dim: "/pricing" });

    expect((await json(projectAnalytics(call(read, "/projects/acme/analytics?from=last-week"), slug))).body).toEqual({ error: "from must be a date such as 2026-10-01" });
    expect((await objectAnalytics(call(read, `/analytics/gadget/${w.id}`), params({ type: "gadget", id: w.id }))).status).toBe(404);
    expect((await objectAnalytics(call(read, "/analytics/widget/w_000000000000"), params({ type: "widget", id: "w_000000000000" }))).status).toBe(404);
  });

  it("API-02 answers 404 when analytics is switched off on the server", async () => {
    process.env.ANALYTICS = "off";
    expect((await json(projectAnalytics(call(read, "/projects/acme/analytics"), slug))).body).toEqual({ error: "Analytics is switched off on this server" });
  });
});
