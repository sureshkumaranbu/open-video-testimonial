import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createKeyRoute, GET as listKeysRoute } from "@/app/api/admin/api-keys/route";
import { GET as auditRoute } from "@/app/api/admin/audit/route";
import { PATCH as patchCampaign } from "@/app/api/admin/campaigns/[id]/route";
import { GET as exportRoute } from "@/app/api/admin/projects/[id]/export/route";
import { GET as listProjectsRoute, POST as createProjectRoute } from "@/app/api/admin/projects/route";
import { GET as projectTestimonials } from "@/app/api/admin/projects/[id]/testimonials/route";
import { PATCH as teamPatch, POST as teamInvite, GET as teamList } from "@/app/api/admin/team/route";
import { PATCH as patchTestimonial } from "@/app/api/admin/testimonials/[id]/route";
import { POST as previewWidget } from "@/app/api/admin/widgets/preview/route";
import { GET as v1Projects } from "@/app/api/v1/projects/route";
import { GET as v1Testimonials } from "@/app/api/v1/projects/[slug]/testimonials/route";
import { GET as v1Testimonial } from "@/app/api/v1/testimonials/[id]/route";
import { canOpen, projectAccessFor } from "@/lib/access";
import { createSessionToken, sessionCookieName } from "@/lib/auth";
import { audit, listAudit, memberActor, pruneAudit } from "@/lib/audit";
import { createCampaign } from "@/lib/campaigns";
import { roleFor } from "@/lib/members";
import { recipients } from "@/lib/notifications/prefs";
import { createProject, createTestimonial } from "@/lib/testimonials";
import { getDb, schema } from "@/db";
import { ADMIN_EMAIL, adminHeaders, params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let a: { id: string; slug: string };
let b: { id: string; slug: string };

beforeEach(() => {
  ctx = useTempDataDir();
  a = createProject({ name: "Alpha", slug: "alpha" });
  b = createProject({ name: "Beta", slug: "beta" });
});
afterEach(() => {
  delete process.env.PLAUDIT_FEATURES;
  delete process.env.ALLOWED_EMAIL_DOMAINS;
  delete process.env.MAIL_OUTBOX;
  ctx.cleanup();
});

/** A dashboard request as `email` (the owner by default). */
function as(email: string | null, url: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const headers: Record<string, string> = { "sec-fetch-site": "same-origin", "content-type": "application/json" };
  if (email) headers.cookie = email === ADMIN_EMAIL ? adminHeaders().cookie : `${sessionCookieName()}=${createSessionToken(email)}`;
  return new Request(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers });
}

async function invite(email: string, role: "admin" | "editor" | "viewer", projectIds: string[] | null = null) {
  const res = await teamInvite(as(ADMIN_EMAIL, "/api/admin/team", { email, role, projectIds }));
  expect(res.status, await res.clone().text()).toBe(201);
}

describe("TEAM-01 roles and per-project access", () => {
  it("TEAM-01 a viewer limited to one project sees only it, and can read but not change", async () => {
    await invite("vera@example.com", "viewer", [a.id]);
    expect(roleFor("vera@example.com")).toBe("viewer");
    const t = createTestimonial(a.id, { name: "Ada", text: "Great" }, { source: "api" });

    const list = await (await listProjectsRoute(as("vera@example.com", "/api/admin/projects"))).json();
    expect(list.projects.map((p: { slug: string }) => p.slug)).toEqual(["alpha"]);
    expect((await projectTestimonials(as("vera@example.com", `/api/admin/projects/${a.id}/testimonials`), params({ id: a.id }))).status).toBe(200);
    const other = await projectTestimonials(as("vera@example.com", `/api/admin/projects/${b.id}/testimonials`), params({ id: b.id }));
    expect(other.status).toBe(403);
    expect((await other.json()).error).toBe("You don't have access to this project");

    const change = await patchTestimonial(as("vera@example.com", `/api/admin/testimonials/${t.id}`, { status: "approved" }, "PATCH"), params({ id: t.id }));
    expect(change.status).toBe(403);
    expect((await change.json()).error).toMatch(/only view and share/);
    // A project named in the body is checked too.
    const preview = await previewWidget(as("vera@example.com", "/api/admin/widgets/preview", { projectId: b.id, config: {} }));
    expect(preview.status).toBe(403);
  });

  it("TEAM-01 an editor changes content and runs campaigns, but not keys, the team or new projects", async () => {
    process.env.MAIL_OUTBOX = "true";
    await invite("ed@example.com", "editor", null);
    const t = createTestimonial(b.id, { name: "Bo", text: "Fine" }, { source: "api" });
    expect((await patchTestimonial(as("ed@example.com", `/api/admin/testimonials/${t.id}`, { status: "approved" }, "PATCH"), params({ id: t.id }))).status).toBe(200);
    const c = createCampaign({ ...a, name: "Alpha" } as never, { name: "Spring" });
    expect((await patchCampaign(as("ed@example.com", `/api/admin/campaigns/${c.id}`, { status: "active" }, "PATCH"), params({ id: c.id }))).status).toBe(200);
    expect((await listKeysRoute(as("ed@example.com", "/api/admin/api-keys"))).status).toBe(403);
    expect((await teamList(as("ed@example.com", "/api/admin/team"))).status).toBe(403);
    expect((await createProjectRoute(as("ed@example.com", "/api/admin/projects", { name: "Gamma", slug: "gamma" }))).status).toBe(403);
  });

  it("TEAM-01 the owner changes the role of someone let in by a domain; the owner's own role can't change", async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = "team.example";
    expect(roleFor("pat@team.example")).toBe("admin");
    const res = await teamPatch(as(ADMIN_EMAIL, "/api/admin/team", { email: "pat@team.example", role: "viewer", projectIds: [b.id] }, "PATCH"));
    expect(res.status).toBe(200);
    expect(roleFor("pat@team.example")).toBe("viewer");
    expect(canOpen(projectAccessFor("pat@team.example", "viewer"), a.id)).toBe(false);
    expect((await teamPatch(as(ADMIN_EMAIL, "/api/admin/team", { email: ADMIN_EMAIL, role: "viewer", projectIds: null }, "PATCH"))).status).toBe(400);
    expect((await teamPatch(as(ADMIN_EMAIL, "/api/admin/team", { email: "nobody@else.example", role: "viewer", projectIds: null }, "PATCH"))).status).toBe(404);
    // Only the owner changes people.
    await invite("adam@example.com", "admin");
    expect((await teamPatch(as("adam@example.com", "/api/admin/team", { email: "pat@team.example", role: "admin", projectIds: null }, "PATCH"))).status).toBe(403);
  });

  it("TEAM-01 with team2 off everyone but the owner is an admin with every project, as before roles", async () => {
    await invite("vera@example.com", "viewer", [a.id]);
    process.env.PLAUDIT_FEATURES = "forms,widgets";
    expect(roleFor("vera@example.com")).toBe("admin");
    const list = await (await listProjectsRoute(as("vera@example.com", "/api/admin/projects"))).json();
    expect(list.projects).toHaveLength(2);
  });

  it("TEAM-01 an API key made for one project reaches only that project; older keys reach all", async () => {
    const make = async (projectIds?: string[]) =>
      ((await (await createKeyRoute(as(ADMIN_EMAIL, "/api/admin/api-keys", { name: "k", scope: "read", projectIds }))).json()) as { key: string }).key;
    const limited = await make([a.id]);
    const wide = await make();
    const key = (k: string, url: string) => new Request(`http://localhost${url}`, { headers: { authorization: `Bearer ${k}` } });
    const tb = createTestimonial(b.id, { name: "Bo", text: "Fine" }, { source: "api" });
    expect((await (await v1Projects(key(limited, "/api/v1/projects"))).json()).data.map((p: { slug: string }) => p.slug)).toEqual(["alpha"]);
    expect((await (await v1Projects(key(wide, "/api/v1/projects"))).json()).data).toHaveLength(2);
    expect((await v1Testimonials(key(limited, "/api/v1/projects/beta/testimonials"), params({ slug: "beta" }))).status).toBe(404);
    expect((await v1Testimonial(key(limited, `/api/v1/testimonials/${tb.id}`), params({ id: tb.id }))).status).toBe(404);
    expect((await v1Testimonial(key(wide, `/api/v1/testimonials/${tb.id}`), params({ id: tb.id }))).status).toBe(200);
    const keys = await (await listKeysRoute(as(ADMIN_EMAIL, "/api/admin/api-keys"))).json();
    expect(keys.keys.map((k: { projectIds: string[] | null }) => k.projectIds)).toEqual(expect.arrayContaining([[a.id], null]));
  });

  it("TEAM-01 notification emails go only to the projects someone may open", async () => {
    await invite("vera@example.com", "viewer", [a.id]);
    getDb().update(schema.members).set({ lastSignInAt: new Date() }).run();
    getDb().insert(schema.memberPrefs).values({ email: "vera@example.com", notifications: JSON.stringify({ newTestimonial: "instant" }) }).run();
    const forB = recipients((p) => p.newTestimonial === "instant" && (p.projectIds.length === 0 || p.projectIds.includes(b.id)));
    const forA = recipients((p) => p.newTestimonial === "instant" && (p.projectIds.length === 0 || p.projectIds.includes(a.id)));
    expect(forB.map((r) => r.email)).toEqual([]);
    expect(forA.map((r) => r.email)).toEqual(["vera@example.com"]);
  });
});

describe("TEAM-02 audit log", () => {
  it("TEAM-02 approvals, exports, keys and invitations are logged with who did them, and filter by action and person", async () => {
    const t = createTestimonial(a.id, { name: "Ada", text: "Great" }, { source: "api" });
    await patchTestimonial(as(ADMIN_EMAIL, `/api/admin/testimonials/${t.id}`, { status: "approved" }, "PATCH"), params({ id: t.id }));
    await exportRoute(as(ADMIN_EMAIL, `/api/admin/projects/${a.id}/export?format=csv`), params({ id: a.id }));
    await createKeyRoute(as(ADMIN_EMAIL, "/api/admin/api-keys", { name: "Zapier", scope: "write" }));
    await invite("ed@example.com", "editor", [a.id]);

    const all = await (await auditRoute(as(ADMIN_EMAIL, "/api/admin/audit"))).json();
    expect(all.entries.map((e: { action: string }) => e.action)).toEqual(["member.invite", "api_key.create", "export.csv", "testimonial.approve"]);
    expect(all.entries[3]).toMatchObject({ actorType: "member", actorLabel: ADMIN_EMAIL, objectId: t.id, projectId: a.id, summary: "Ada" });
    expect(JSON.stringify(all.entries)).not.toMatch(/plk_[A-Za-z0-9_-]{20}/);

    const testimonials = await (await auditRoute(as(ADMIN_EMAIL, "/api/admin/audit?action=testimonial."))).json();
    expect(testimonials.entries).toHaveLength(1);
    audit(memberActor("someone@example.com"), "export.zip", { projectId: b.id });
    const theirs = await (await auditRoute(as(ADMIN_EMAIL, "/api/admin/audit?actor=someone%40example.com"))).json();
    expect(theirs.entries.map((e: { action: string }) => e.action)).toEqual(["export.zip"]);
    expect((await auditRoute(as(ADMIN_EMAIL, "/api/admin/audit?from=yesterday"))).status).toBe(400);
  });

  it("TEAM-02 is for admins, downloads as CSV with formulas neutralised, and is pruned after AUDIT_RETENTION_DAYS", async () => {
    await invite("ed@example.com", "editor");
    expect((await auditRoute(as("ed@example.com", "/api/admin/audit"))).status).toBe(403);
    audit(memberActor(ADMIN_EMAIL), "testimonial.edit", { summary: "=HYPERLINK(evil)" });
    const csv = await (await auditRoute(as(ADMIN_EMAIL, "/api/admin/audit?format=csv"))).text();
    expect(csv.split("\r\n")[0]).toBe("at,actor_type,actor,action,object_type,object_id,project_id,summary");
    expect(csv).toContain("'=HYPERLINK(evil)");
    expect(pruneAudit(Date.now() + 400 * 86_400_000)).toBeGreaterThan(0);
    expect(listAudit({}, { limit: 10, offset: 0 }).total).toBe(0);
  });

  it("TEAM-02 records nothing with team2 off", async () => {
    process.env.PLAUDIT_FEATURES = "forms";
    audit(memberActor(ADMIN_EMAIL), "export.zip");
    expect(listAudit({}, { limit: 10, offset: 0 }).total).toBe(0);
    expect((await auditRoute(as(ADMIN_EMAIL, "/api/admin/audit"))).status).toBe(404);
  });
});
