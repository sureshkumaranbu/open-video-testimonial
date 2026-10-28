import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as jobRoute } from "@/app/api/admin/jobs/[id]/route";
import { GET as media } from "@/app/api/media/[...key]/route";
import { POST as teamInvite } from "@/app/api/admin/team/route";
import { getDb, schema } from "@/db";
import { createApiKey } from "@/lib/api-keys";
import { createSessionToken, sessionCookieName } from "@/lib/auth";
import { enqueue } from "@/lib/jobs";
import { saveFile } from "@/lib/storage";
import { createProject, createTestimonial, mediaProjectIds, mediaProjectsQuery, updateTestimonial } from "@/lib/testimonials";
import { ADMIN_EMAIL, adminHeaders, params, PNG_BYTES, useTempDataDir, WEBM_BYTES } from "./helpers";

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
  ctx.cleanup();
});

const cookieOf = (email: string) => ({ cookie: `${sessionCookieName()}=${createSessionToken(email)}`, "sec-fetch-site": "same-origin" });

async function invite(email: string, role: "admin" | "editor" | "viewer", projectIds: string[] | null = null) {
  const res = await teamInvite(
    new Request("http://localhost/api/admin/team", {
      method: "POST",
      body: JSON.stringify({ email, role, projectIds }),
      headers: { ...adminHeaders(), "content-type": "application/json" },
    }),
  );
  expect(res.status, await res.clone().text()).toBe(201);
}

async function stored(bytes: Uint8Array, mime: string, kind: "video" | "image") {
  const tmp = path.join(ctx.dir, `src-${crypto.randomUUID()}`);
  fs.writeFileSync(tmp, bytes);
  return (await saveFile(tmp, mime, kind)).key;
}

const get = (key: string, headers: Record<string, string> = {}) =>
  media(new Request(`http://localhost/api/media/${key}`, { headers }), params({ key: key.split("/") }));
const statuses = (keys: string[], headers: Record<string, string> = {}) => Promise.all(keys.map(async (k) => (await get(k, headers)).status));

describe("L18 private media follows project access", () => {
  it("L18 a member limited to one project gets only that project's private files; owner, admins and unlimited members get all", async () => {
    await invite("vera@example.com", "viewer", [a.id]);
    await invite("ed@example.com", "editor", null);
    await invite("ann@example.com", "admin", null);
    const mine = await stored(WEBM_BYTES, "video/webm", "video");
    const theirs = await stored(WEBM_BYTES, "video/webm", "video");
    createTestimonial(a.id, { name: "Ada", videoKey: mine, videoMime: "video/webm" });
    createTestimonial(b.id, { name: "Bo", videoKey: theirs, videoMime: "video/webm" });

    expect(await statuses([mine, theirs], cookieOf("vera@example.com"))).toEqual([200, 404]);
    for (const who of ["ed@example.com", "ann@example.com", ADMIN_EMAIL]) expect(await statuses([mine, theirs], cookieOf(who))).toEqual([200, 200]);
    const res = await get(mine, cookieOf("vera@example.com"));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect((await get(theirs, cookieOf("vera@example.com"))).headers.get("cache-control")).toBe("no-store");
  });

  it("L18 a file used by several projects is served if any of them is open; one nothing uses only to unlimited people", async () => {
    await invite("vera@example.com", "viewer", [a.id]);
    const shared = await stored(PNG_BYTES, "image/png", "image");
    const orphan = await stored(PNG_BYTES, "image/png", "image");
    createTestimonial(b.id, { name: "Bo", text: "Fine", avatarKey: shared });
    expect(await statuses([shared, orphan], cookieOf("vera@example.com"))).toEqual([404, 404]);
    // The same photo is also a customer's in project A (a merge or an import can do that).
    getDb().insert(schema.customers).values({ id: crypto.randomUUID(), projectId: a.id, name: "Bo", avatarKey: shared }).run();
    expect(mediaProjectIds(shared).sort()).toEqual([a.id, b.id].sort());
    expect(await statuses([shared, orphan], cookieOf("vera@example.com"))).toEqual([200, 404]);
    expect(await statuses([shared, orphan], adminHeaders())).toEqual([200, 200]);
  });

  it("L18 finds the project of every kind of file", async () => {
    const k = await Promise.all(Array.from({ length: 9 }, () => stored(PNG_BYTES, "image/png", "image")));
    const t = createTestimonial(b.id, { name: "Bo", text: "Fine", companyLogoKey: k[0] });
    const db = getDb();
    db.insert(schema.answers).values({ id: crypto.randomUUID(), testimonialId: t.id, questionKey: "q2", questionTitle: "And?", position: 1, posterKey: k[1] }).run();
    db.insert(schema.testimonialImages).values({ id: crypto.randomUUID(), testimonialId: t.id, key: k[2] }).run();
    db.insert(schema.shareAssets).values({ id: crypto.randomUUID(), projectId: b.id, kind: "logo", key: k[3] }).run();
    db.update(schema.projects).set({ logoKey: k[4] }).where(eq(schema.projects.id, b.id)).run();
    db.update(schema.forms).set({ logoKey: k[5] }).where(eq(schema.forms.projectId, b.id)).run();
    db.insert(schema.walls).values({ id: crypto.randomUUID(), projectId: b.id, slug: "love", name: "Love", faviconKey: k[6] }).run();
    db.insert(schema.boosters).values({ id: crypto.randomUUID(), projectId: b.id, slug: "go", name: "Go", logoKey: k[7] }).run();
    db.insert(schema.customers).values({ id: crypto.randomUUID(), projectId: b.id, name: "Cy", avatarKey: k[8] }).run();
    for (const key of k) expect(mediaProjectIds(key), key).toEqual([b.id]);
  });

  it("L18 looks the projects up with an index for every kind of file", () => {
    const plan = getDb()
      .all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${mediaProjectsQuery("images/k.png")}`)
      .map((r) => r.detail);
    expect(plan.filter((d) => /\bUSING (COVERING )?INDEX\b/.test(d)).length).toBeGreaterThanOrEqual(9);
    expect(plan.filter((d) => /^SCAN /.test(d))).toEqual([]);
  });

  it("L18 an API key made for one project reads only that project's private files; older keys read all", async () => {
    const mine = await stored(WEBM_BYTES, "video/webm", "video");
    const theirs = await stored(WEBM_BYTES, "video/webm", "video");
    createTestimonial(a.id, { name: "Ada", videoKey: mine, videoMime: "video/webm" });
    const other = createTestimonial(b.id, { name: "Bo", videoKey: theirs, videoMime: "video/webm" });
    const { key: limited } = createApiKey("Alpha only", "read", [a.id]);
    const { key: all } = createApiKey("Everything", "read");
    expect(await statuses([mine, theirs], { authorization: `Bearer ${limited}` })).toEqual([200, 404]);
    expect(await statuses([mine, theirs], { authorization: `Bearer ${all}` })).toEqual([200, 200]);
    // Public files are for everyone, as before.
    updateTestimonial(other.id, { status: "approved" });
    expect(await statuses([theirs], { authorization: `Bearer ${limited}` })).toEqual([200]);
    expect(await statuses([theirs])).toEqual([200]);
  });

  it("L18 with team2 off every member reaches every project's files, as before", async () => {
    await invite("vera@example.com", "viewer", [a.id]);
    const theirs = await stored(WEBM_BYTES, "video/webm", "video");
    createTestimonial(b.id, { name: "Bo", videoKey: theirs, videoMime: "video/webm" });
    process.env.PLAUDIT_FEATURES = "none";
    expect(await statuses([theirs], cookieOf("vera@example.com"))).toEqual([200]);
  });
});

describe("L19 job progress follows project access", () => {
  const poll = (id: string, headers: Record<string, string>) => jobRoute(new Request(`http://localhost/api/admin/jobs/${id}`, { headers }), params({ id }));

  it("L19 a member limited to some projects sees only their jobs, and the same 404 as an unknown id otherwise", async () => {
    await invite("vera@example.com", "viewer", [a.id]);
    const tA = createTestimonial(a.id, { name: "Ada", text: "Great" });
    const tB = createTestimonial(b.id, { name: "Bo", text: "Fine" });
    const jobs = {
      ownProject: enqueue("test.import", { zipPath: "/tmp/x.zip", projectId: a.id }).id,
      otherProject: enqueue("test.import", { zipPath: "/tmp/y.zip", projectId: b.id }).id,
      ownTestimonial: enqueue("test.transcribe", { testimonialId: tA.id }).id,
      otherTestimonial: enqueue("test.transcribe", { testimonialId: tB.id }).id,
      noProject: enqueue("test.storage", { key: "videos/x.webm" }).id,
      unreadable: getDb().insert(schema.jobs).values({ id: crypto.randomUUID(), type: "test.broken", payload: "{oops" }).returning().get().id,
    };
    const vera = cookieOf("vera@example.com");
    const seen = async (id: string, headers: Record<string, string>) => {
      const res = await poll(id, headers);
      return res.status === 200 ? 200 : `${res.status} ${(await res.json()).error}`;
    };
    expect(await seen(jobs.ownProject, vera)).toBe(200);
    expect(await seen(jobs.ownTestimonial, vera)).toBe(200);
    for (const id of [jobs.otherProject, jobs.otherTestimonial, jobs.noProject, jobs.unreadable, crypto.randomUUID()]) {
      expect(await seen(id, vera)).toBe("404 Job not found");
    }
    for (const id of Object.values(jobs)) expect(await seen(id, adminHeaders())).toBe(200);
  });

  it("L19 a job that names no project is for admins, not for unlimited editors", async () => {
    await invite("ed@example.com", "editor", null);
    await invite("ann@example.com", "admin", null);
    const t = createTestimonial(b.id, { name: "Bo", text: "Fine" });
    const projectJob = enqueue("test.transcribe", { testimonialId: t.id }).id;
    const loose = enqueue("test.digest", { email: "x@example.com", kind: "weekly" }).id;
    expect((await poll(projectJob, cookieOf("ed@example.com"))).status).toBe(200);
    expect((await poll(loose, cookieOf("ed@example.com"))).status).toBe(404);
    expect((await poll(loose, cookieOf("ann@example.com"))).status).toBe(200);
    expect((await poll(loose, {})).status).toBe(401);
  });
});
