import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as media } from "@/app/api/media/[...key]/route";
import { GET, OPTIONS } from "@/app/api/widget/[slug]/route";
import { createProject, createTestimonial, updateTestimonial } from "@/lib/testimonials";
import { params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => ctx.cleanup());

function widget(query = "") {
  return GET(new Request(`http://localhost/api/widget/acme${query}`), params({ slug: "acme" }));
}

describe("GET /api/widget/:slug", () => {
  it("returns only approved testimonials, newest first", async () => {
    const a = createTestimonial(projectId, { name: "Approved One", text: "Yes", rating: 4 });
    createTestimonial(projectId, { name: "Still Pending", text: "Hmm" });
    const r = createTestimonial(projectId, { name: "Rejected", text: "No" });
    updateTestimonial(a.id, { status: "approved" });
    updateTestimonial(r.id, { status: "rejected" });

    const res = await widget();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.project).toEqual({ name: "Acme", slug: "acme", accentColor: "#0f766e" });
    expect(body.testimonials.map((t: { name: string }) => t.name)).toEqual(["Approved One"]);
    expect(body.testimonials[0]).toMatchObject({ rating: 4, text: "Yes", video: null });
  });

  it("never exposes private fields", async () => {
    const t = createTestimonial(projectId, {
      name: "Private Person",
      email: "secret@example.com",
      text: "Hi",
      videoKey: "videos/00000000-0000-0000-0000-000000000000.webm",
      videoMime: "video/webm",
    });
    updateTestimonial(t.id, { status: "approved" });
    const raw = await (await widget()).text();
    expect(raw).not.toContain("secret@example.com");
    const [item] = JSON.parse(raw).testimonials;
    expect(Object.keys(item).sort()).toEqual(
      ["avatarUrl", "company", "createdAt", "id", "name", "rating", "tags", "text", "title", "video"].sort(),
    );
    expect(item.video).toEqual({
      url: "/api/media/videos/00000000-0000-0000-0000-000000000000.webm",
      mime: "video/webm",
      poster: null,
      width: null,
      height: null,
      durationMs: null,
      sources: [{ url: "/api/media/videos/00000000-0000-0000-0000-000000000000.webm", type: "video/webm" }],
      captionsUrl: null,
      transcript: null,
    });
  });

  it("filters by tag and limits results", async () => {
    for (const [name, tags] of [["A", ["home"]], ["B", ["pricing"]], ["C", ["home"]]] as const) {
      const t = createTestimonial(projectId, { name, text: name });
      updateTestimonial(t.id, { status: "approved", tags: [...tags] });
    }
    const tagged = await (await widget("?tag=Home")).json();
    expect(tagged.testimonials.map((t: { name: string }) => t.name).sort()).toEqual(["A", "C"]);
    const limited = await (await widget("?limit=1")).json();
    expect(limited.testimonials).toHaveLength(1);
  });

  it("is readable cross-origin", async () => {
    const res = await widget();
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(OPTIONS().status).toBe(204);
  });

  it("404s for unknown projects", async () => {
    const res = await GET(new Request("http://localhost/api/widget/nope"), params({ slug: "nope" }));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/media/*", () => {
  const key = "videos/11111111-1111-1111-1111-111111111111.webm";

  beforeEach(() => {
    const file = path.join(ctx.dir, "uploads", key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from("0123456789"));
    // Public only while it belongs to an approved testimonial (see media-access.test.ts).
    const t = createTestimonial(projectId, { name: "Ada", videoKey: key, videoMime: "video/webm" });
    updateTestimonial(t.id, { status: "approved" });
  });

  const get = (k: string, headers: Record<string, string> = {}) =>
    media(new Request(`http://localhost/api/media/${k}`, { headers }), params({ key: k.split("/") }));

  it("serves the whole file with the right type", async () => {
    const res = await get(key);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/webm");
    expect(await res.text()).toBe("0123456789");
  });

  it("supports byte ranges for video seeking", async () => {
    let res = await get(key, { range: "bytes=2-5" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await res.text()).toBe("2345");
    res = await get(key, { range: "bytes=-3" });
    expect(await res.text()).toBe("789");
    res = await get(key, { range: "bytes=20-" });
    expect(res.status).toBe(416);
  });

  it("refuses path traversal and unknown keys", async () => {
    expect((await get("../plaudit.db")).status).toBe(404);
    expect((await get("videos/22222222-2222-2222-2222-222222222222.webm")).status).toBe(404);
  });
});
