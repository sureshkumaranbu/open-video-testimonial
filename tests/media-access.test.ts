import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as media } from "@/app/api/media/[...key]/route";
import { getDb, schema } from "@/db";
import { createApiKey } from "@/lib/api-keys";
import { withdrawConsent } from "@/lib/consent";
import { saveFile } from "@/lib/storage";
import { createProject, createTestimonial, publicMediaQuery, updateTestimonial } from "@/lib/testimonials";
import { adminHeaders, params, PNG_BYTES, WEBM_BYTES, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => ctx.cleanup());

async function stored(bytes: Uint8Array, mime: string, kind: "video" | "image") {
  const tmp = path.join(ctx.dir, `src-${Math.random()}`);
  fs.writeFileSync(tmp, bytes);
  return (await saveFile(tmp, mime, kind)).key;
}

/** A testimonial with an avatar, a converted video, the original upload and a poster. */
async function withMedia() {
  const avatarKey = await stored(PNG_BYTES, "image/png", "image");
  const originalKey = await stored(WEBM_BYTES, "video/webm", "video");
  const t = createTestimonial(projectId, { name: "Ada", text: "Great", avatarKey, videoKey: originalKey, videoMime: "video/webm" });
  const videoKey = await stored(WEBM_BYTES, "video/webm", "video");
  const posterKey = await stored(PNG_BYTES, "image/png", "image");
  getDb()
    .update(schema.testimonials)
    .set({ videoKey, posterKey, videoOriginalKey: originalKey })
    .where(eq(schema.testimonials.id, t.id))
    .run();
  return { id: t.id, keys: [avatarKey, videoKey, originalKey, posterKey] };
}

function get(key: string, headers: Record<string, string> = {}) {
  return media(new Request(`http://localhost/api/media/${key}`, { headers }), params({ key: key.split("/") }));
}

async function statuses(keys: string[], headers: Record<string, string> = {}) {
  return Promise.all(keys.map(async (k) => (await get(k, headers)).status));
}

describe("media access", () => {
  it("serves an approved testimonial's files to anyone, revalidated on every use", async () => {
    const { id, keys } = await withMedia();
    updateTestimonial(id, { status: "approved" });
    expect(await statuses(keys)).toEqual([200, 200, 200, 200]);
    const res = await get(keys[1]);
    expect(res.headers.get("cache-control")).toBe("public, no-cache");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const etag = res.headers.get("etag")!;
    expect((await get(keys[1], { "if-none-match": etag })).status).toBe(304);
    expect((await get(keys[1], { range: "bytes=0-3" })).status).toBe(206);
  });

  for (const status of ["pending", "rejected"] as const) {
    it(`hides a ${status} testimonial's files from visitors but not from the owner`, async () => {
      const { id, keys } = await withMedia();
      updateTestimonial(id, { status: "approved" });
      updateTestimonial(id, { status });
      expect(await statuses(keys)).toEqual([404, 404, 404, 404]);
      expect(await statuses(keys, adminHeaders())).toEqual([200, 200, 200, 200]);
      const res = await get(keys[1], adminHeaders());
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect((await get(keys[1], adminHeaders())).headers.get("etag")).toBeNull();
    });
  }

  it("takes a withdrawn testimonial's files down straight away", async () => {
    const { id, keys } = await withMedia();
    updateTestimonial(id, { status: "approved" });
    expect(await statuses(keys)).toEqual([200, 200, 200, 200]);
    withdrawConsent(id, { actor: "customer" });
    expect(await statuses(keys)).toEqual([404, 404, 404, 404]);
    expect(await statuses(keys, adminHeaders())).toEqual([200, 200, 200, 200]);
  });

  it("lets a REST API key read unpublished files, and nothing else does", async () => {
    const { keys } = await withMedia();
    const { key: secret } = createApiKey("Zapier", "read");
    expect(await statuses(keys, { authorization: `Bearer ${secret}` })).toEqual([200, 200, 200, 200]);
    expect(await statuses(keys, { authorization: "Bearer plk_not-a-real-key-at-all-000000" })).toEqual([404, 404, 404, 404]);
    expect(await statuses(keys, { cookie: "plaudit_session=forged.value" })).toEqual([404, 404, 404, 404]);
  });

  it("keeps files no testimonial uses private", async () => {
    const orphan = await stored(PNG_BYTES, "image/png", "image");
    expect((await get(orphan)).status).toBe(404);
    expect((await get(orphan, adminHeaders())).status).toBe(200);
  });
});

describe("media access for Phase 1 files", () => {
  const image = () => stored(PNG_BYTES, "image/png", "image");

  for (const status of ["hidden", "trashed"] as const) {
    it(`hides a ${status} testimonial's files from visitors`, async () => {
      const { id, keys } = await withMedia();
      updateTestimonial(id, { status: "approved" });
      updateTestimonial(id, { status });
      expect(await statuses(keys)).toEqual([404, 404, 404, 404]);
      expect(await statuses(keys, adminHeaders())).toEqual([200, 200, 200, 200]);
    });
  }

  it("shows a company logo and attached images only while the testimonial is public", async () => {
    const [logo, shot] = [await image(), await image()];
    const t = createTestimonial(projectId, { name: "Ada", text: "Great", companyLogoKey: logo });
    getDb().insert(schema.testimonialImages).values({ id: crypto.randomUUID(), testimonialId: t.id, key: shot }).run();
    expect(await statuses([logo, shot])).toEqual([404, 404]);
    updateTestimonial(t.id, { status: "approved" });
    expect(await statuses([logo, shot])).toEqual([200, 200]);
    withdrawConsent(t.id, { actor: "customer" });
    expect(await statuses([logo, shot])).toEqual([404, 404]);
  });

  it("keeps answer videos (questions 2..N) private, even on an approved testimonial (D13)", async () => {
    const t = createTestimonial(projectId, { name: "Ada", text: "Great" });
    const [video, original, poster] = [
      await stored(WEBM_BYTES, "video/webm", "video"),
      await stored(WEBM_BYTES, "video/webm", "video"),
      await image(),
    ];
    getDb()
      .insert(schema.answers)
      .values({ id: crypto.randomUUID(), testimonialId: t.id, questionKey: "q2", questionTitle: "And then?", position: 1, videoKey: video, videoOriginalKey: original, posterKey: poster })
      .run();
    updateTestimonial(t.id, { status: "approved" });
    expect(await statuses([video, original, poster])).toEqual([404, 404, 404]);
    expect(await statuses([video, original, poster], adminHeaders())).toEqual([200, 200, 200]);
  });

  it("always shows project and form logos", async () => {
    const [projectLogo, formLogo] = [await image(), await image()];
    getDb().update(schema.projects).set({ logoKey: projectLogo }).where(eq(schema.projects.id, projectId)).run();
    getDb().update(schema.forms).set({ logoKey: formLogo }).where(eq(schema.forms.projectId, projectId)).run();
    expect(await statuses([projectLogo, formLogo])).toEqual([200, 200]);
  });

  it("shows a wall's logo and cover once the wall is published", async () => {
    const [logo, cover] = [await image(), await image()];
    const wallId = crypto.randomUUID();
    getDb().insert(schema.walls).values({ id: wallId, projectId, slug: "love", name: "Love", logoKey: logo, coverKey: cover }).run();
    expect(await statuses([logo, cover])).toEqual([404, 404]);
    getDb().update(schema.walls).set({ published: true }).where(eq(schema.walls.id, wallId)).run();
    expect(await statuses([logo, cover])).toEqual([200, 200]);
  });

  it("answers with one indexed lookup per kind of file", () => {
    const plan = getDb()
      .all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${publicMediaQuery("images/k.png")}`)
      .map((r) => r.detail);
    expect(plan.filter((d) => /\bUSING (COVERING )?INDEX\b/.test(d)).length).toBeGreaterThanOrEqual(5);
    expect(plan.filter((d) => /^SCAN /.test(d))).toEqual([]);
  });
});
