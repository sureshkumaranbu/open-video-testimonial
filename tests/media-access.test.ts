import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as media } from "@/app/api/media/[...key]/route";
import { getDb, schema } from "@/db";
import { createApiKey } from "@/lib/api-keys";
import { withdrawConsent } from "@/lib/consent";
import { saveFile } from "@/lib/storage";
import { createProject, createTestimonial, updateTestimonial } from "@/lib/testimonials";
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
