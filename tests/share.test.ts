import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as assetsRoute, GET as listAssetsRoute } from "@/app/api/admin/projects/[id]/share/assets/route";
import { POST as renderRoute } from "@/app/api/admin/projects/[id]/share/render/route";
import { GET as listTemplatesRoute, POST as templatesRoute } from "@/app/api/admin/projects/[id]/share/templates/route";
import { POST as zipRoute } from "@/app/api/admin/projects/[id]/share/zip/route";
import { DELETE as deleteAssetRoute } from "@/app/api/admin/share-assets/[assetId]/route";
import { DELETE as deleteTemplateRoute, PATCH as patchTemplateRoute } from "@/app/api/admin/share-templates/[templateId]/route";
import { env } from "@/lib/env";
import { setHighlights } from "@/lib/highlights";
import { brandDesign, designSize, MAX_PIXELS, SHARE_TEMPLATES, shareDesignSchema, SIZE_PRESETS } from "@/lib/share/design";
import { clipSegments, patternSvg, renderPng, segmentsFromHighlights, segmentsFromMarkers, shareCards } from "@/lib/share/render";
import { resetFfmpegCheck } from "@/lib/media";
import { createProject, createTestimonial, getTestimonial } from "@/lib/testimonials";
import { openZip } from "@/lib/zip";
import { adminHeaders, hasFfmpeg, params, PNG_BYTES, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let project: ReturnType<typeof createProject>;
let ids: string[];

const AVATAR = fs.readFileSync(path.resolve(__dirname, "../e2e/fixtures/avatar.png"));

beforeEach(() => {
  ctx = useTempDataDir();
  resetFfmpegCheck();
  project = createProject({ name: "Acme", slug: "acme" });
  ids = ["Ada Lovelace", "Grace Hopper", "Alan Turing", "Katherine Johnson", "Linus T", "Margaret Hamilton"].map(
    (name, i) => createTestimonial(project.id, { name, text: `Testimonial ${i + 1}: the product saved our team hours every week. 🎉`, rating: 5, title: "Engineer", company: "Northwind" }).id,
  );
});
afterEach(() => {
  resetFfmpegCheck();
  ctx.cleanup();
});

/** Width and height from a PNG's IHDR. */
function pngSize(png: Uint8Array) {
  const b = Buffer.from(png);
  expect(b.subarray(1, 4).toString()).toBe("PNG");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] };
}

const json = (body: unknown, headers: Record<string, string> = adminHeaders()) => ({ method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
const req = (init: RequestInit = {}) => new Request("http://localhost/x", init);
const P = () => params({ id: project.id });

describe("SHARE-01 templates and sizes", () => {
  it("SHARE-01 ships at least 12 templates of our own, for 1, 3 and 6 testimonials", () => {
    expect(SHARE_TEMPLATES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(SHARE_TEMPLATES.map((t) => t.max))).toEqual(new Set([1, 3, 6]));
    expect(SIZE_PRESETS.map((s) => s.id)).toEqual(["square", "portrait", "story", "landscape", "linkedin", "x", "email"]);
    expect(SIZE_PRESETS.find((s) => s.id === "email")).toMatchObject({ width: 600, height: 200 });
  });

  it("SHARE-01 every template renders on the server at its size", async () => {
    for (const t of SHARE_TEMPLATES) {
      const design = shareDesignSchema.parse({ template: t.id, size: { preset: "portrait" } });
      const png = await renderPng({ design, items: ids.slice(0, t.max).map((id) => ({ id })) }, { project });
      expect(pngSize(png), t.id).toMatchObject({ width: 1080, height: 1350 });
    }
  }, 60_000);

  it("SHARE-01 every size preset and a custom W×H render, with each background kind", async () => {
    for (const s of SIZE_PRESETS) {
      const png = await renderPng({ design: shareDesignSchema.parse({ template: "trio", size: { preset: s.id } }), items: ids.slice(0, 3).map((id) => ({ id })) }, { project });
      expect(pngSize(png)).toMatchObject({ width: s.width, height: s.height });
    }
    for (const kind of ["solid", "gradient", "pattern", "transparent"] as const) {
      const design = shareDesignSchema.parse({ size: { preset: "custom", width: 640, height: 400 }, background: { kind, color: "#223344", color2: "#ffcc00" }, theme: "dark" });
      expect(pngSize(await renderPng({ design, items: [{ id: ids[0] }] }, { project }))).toMatchObject({ width: 640, height: 400, colorType: 6 });
    }
    expect(shareDesignSchema.safeParse({ size: { preset: "custom", width: 2400, height: 2400 } }).success).toBe(false);
    expect(shareDesignSchema.safeParse({ size: { preset: "custom", width: 100, height: 400 } }).success).toBe(false);
    expect(2048 * 2048).toBe(MAX_PIXELS);
  });

  it("SHARE-01 patterns are our own SVG, and an email banner keeps a short quote", async () => {
    for (const p of ["dots", "grid", "diagonal", "waves", "confetti"] as const) expect(patternSvg(p, 100, 100, "rgba(0,0,0,.2)", 2)).toMatch(/^data:image\/svg\+xml;base64,/);
    const [card] = await shareCards(project.id, [{ id: ids[0], text: "x ".repeat(400) }], { banner: true });
    expect(card.segments.map((s) => s.text).join(" ").length).toBeLessThanOrEqual(151);
  });

  it("SHARE-01 overrides change only the image: the testimonial keeps its words; **words** and saved highlights are highlighted; emoji are dropped", async () => {
    setHighlights(ids[1], [{ answerId: null, start: 18, end: 36 }]);
    const [a, b] = await shareCards(project.id, [{ id: ids[0], text: "Simply **the best** tool", name: "A. L.", byline: "Founder" }, { id: ids[1] }]);
    expect(a).toMatchObject({ name: "A. L.", byline: "Founder", segments: [{ text: "Simply", hl: false }, { text: "the best", hl: true }, { text: "tool", hl: false }] });
    expect(b.segments.find((s) => s.hl)?.text).toBe("product saved our");
    expect(b.segments.map((s) => s.text).join(" ")).not.toContain("🎉");
    expect(getTestimonial(ids[0])).toMatchObject({ authorName: "Ada Lovelace", text: expect.stringContaining("Testimonial 1"), authorTitle: "Engineer" });
    expect(segmentsFromMarkers("**all**")).toEqual([{ text: "all", hl: true }]);
    expect(segmentsFromHighlights("abc def", [{ start: 4, end: 99 }])).toEqual([{ text: "abc def", hl: false }]);
    expect(clipSegments([{ text: "one two three four", hl: false }], 9)).toEqual([{ text: "one two…", hl: false }]);
  });

  it("SHARE-01 refuses testimonials from another project, signed-out callers and oversized custom images", async () => {
    const other = createProject({ name: "Other", slug: "other" });
    const foreign = createTestimonial(other.id, { name: "Eve", text: "Not yours" }).id;
    const design = shareDesignSchema.parse({});
    expect((await renderRoute(req(json({ design, items: [{ id: foreign }] })), P())).status).toBe(400);
    expect((await renderRoute(req(json({ design, items: [{ id: ids[0] }] }, {})), P())).status).toBe(401);
    expect((await renderRoute(req(json({ design: { size: { preset: "custom", width: 2400, height: 2400 } }, items: [{ id: ids[0] }] })), P())).status).toBe(400);
    expect((await renderRoute(req(json({ design, items: [] })), P())).status).toBe(400);
    const ok = await renderRoute(req(json({ design, items: [{ id: ids[0] }], download: true })), P());
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(ok.headers.get("content-disposition")).toBe('attachment; filename="spotlight-1080x1080.png"');
  });

  it.skipIf(!hasFfmpeg())("SHARE-01 exports JPEG (opaque even with no background) and a ZIP of several", async () => {
    const design = shareDesignSchema.parse({ background: { kind: "transparent" } });
    const jpeg = await renderRoute(req(json({ design, items: [{ id: ids[0] }], format: "jpeg" })), P());
    expect(jpeg.headers.get("content-type")).toBe("image/jpeg");
    expect([...Buffer.from(await jpeg.arrayBuffer()).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

    const renders = ["square", "story", "email"].map((preset) => ({ design: { ...design, size: { preset, width: 1080, height: 1080 } }, items: [{ id: ids[0] }] }));
    const res = await zipRoute(req(json({ renders })), P());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const file = path.join(ctx.dir, "out.zip");
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    expect([...(await openZip(file)).entries.keys()].sort()).toEqual(["spotlight-1080x1080.png", "spotlight-1080x1920.png", "spotlight-600x200.png"]);
    expect((await zipRoute(req(json({ renders: Array(13).fill(renders[0]) })), P())).status).toBe(400);
  });

  it("SHARE-01 JPEG says so when the server has no ffmpeg (the studio then converts the PNG itself)", async () => {
    process.env.MEDIA_PROCESSING = "off";
    try {
      const res = await renderRoute(req(json({ design: shareDesignSchema.parse({}), items: [{ id: ids[0] }], format: "jpeg" })), P());
      expect(res.status).toBe(501);
    } finally {
      delete process.env.MEDIA_PROCESSING;
    }
  });
});

describe("SHARE-01 SHARE-02 uploads, my templates and the brand kit", () => {
  const upload = (bytes: Uint8Array | string, kind = "background", name = "bg.png") => {
    const body = new FormData();
    body.set("file", new File([bytes], name, { type: "image/png" }));
    body.set("kind", kind);
    return assetsRoute(req({ method: "POST", headers: adminHeaders(), body }), P());
  };

  it("SHARE-01 uploads are sniffed PNG or JPEG, size-capped, owner-only, and drawn as background and logo", async () => {
    expect((await upload('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).status).toBe(415);
    expect((await upload(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]))).status).toBe(415); // WebP
    expect((await upload(PNG_BYTES, "poster")).status).toBe(400);
    process.env.MAX_IMAGE_MB = "0.0001";
    try {
      expect((await upload(new Uint8Array(AVATAR))).status).toBe(400);
    } finally {
      delete process.env.MAX_IMAGE_MB;
    }
    const bg = await (await upload(new Uint8Array(AVATAR))).json();
    const logo = await (await upload(new Uint8Array(AVATAR), "logo")).json();
    expect(bg.asset).toMatchObject({ kind: "background", url: expect.stringMatching(/^\/api\/media\/images\//) });
    const listed = await (await listAssetsRoute(req({ headers: adminHeaders() }), P())).json();
    expect(listed.assets).toHaveLength(2);

    const design = shareDesignSchema.parse({ background: { kind: "image", assetId: bg.asset.id }, logo: { source: "upload", assetId: logo.asset.id, position: "bottom-right" } });
    expect(pngSize(await renderPng({ design, items: [{ id: ids[0] }] }, { project })).width).toBe(1080);

    const key = bg.asset.url.replace("/api/media/", "");
    expect(fs.existsSync(path.join(env.uploadsDir, key))).toBe(true);
    expect((await deleteAssetRoute(req({ method: "DELETE", headers: adminHeaders() }), params({ assetId: bg.asset.id }))).status).toBe(200);
    expect(fs.existsSync(path.join(env.uploadsDir, key))).toBe(false);
  });

  it("SHARE-02 saves my templates (the look, never the content), renames and deletes them", async () => {
    const design = shareDesignSchema.parse({ template: "split", theme: "dark", accent: "#aa3366" });
    const created = await templatesRoute(req(json({ name: "Launch week", design })), P());
    expect(created.status).toBe(201);
    const { template } = await created.json();
    expect(template).toMatchObject({ name: "Launch week", design: { template: "split", theme: "dark", accent: "#aa3366" } });
    expect(JSON.stringify(template)).not.toContain(ids[0]);
    const renamed = await patchTemplateRoute(req({ method: "PATCH", headers: { ...adminHeaders(), "content-type": "application/json" }, body: JSON.stringify({ name: "Spring" }) }), params({ templateId: template.id }));
    expect((await renamed.json()).template.name).toBe("Spring");
    expect((await (await listTemplatesRoute(req({ headers: adminHeaders() }), P())).json()).templates).toHaveLength(1);
    // Another project's upload can't be borrowed.
    const other = createProject({ name: "Other", slug: "other" });
    const body = new FormData();
    body.set("file", new File([new Uint8Array(AVATAR)], "l.png", { type: "image/png" }));
    body.set("kind", "logo");
    const foreign = await (await assetsRoute(req({ method: "POST", headers: adminHeaders(), body }), params({ id: other.id }))).json();
    expect((await templatesRoute(req(json({ name: "x", design: { logo: { source: "upload", assetId: foreign.asset.id } } })), P())).status).toBe(400);
    expect((await deleteTemplateRoute(req({ method: "DELETE", headers: adminHeaders() }), params({ templateId: template.id }))).status).toBe(200);
  });

  it("SHARE-02 the brand kit gives the studio its colours, a font it can draw and the project logo", () => {
    const b = brandDesign({ colors: { primary: "#123456", background: "#fafafa", text: "#111111" }, fonts: { heading: "newsreader", body: "geist" } }, { hasLogo: true, fonts: ["geist"] });
    expect(b).toMatchObject({ accent: "#123456", text: "#111111", font: "geist", background: { kind: "solid", color: "#fafafa" }, logo: { source: "brand" } });
    expect(brandDesign({}, { hasLogo: false, fonts: ["geist"] })).toEqual({ background: {}, logo: {} });
    expect(designSize(shareDesignSchema.parse({ size: { preset: "linkedin" } }))).toEqual({ width: 1200, height: 627 });
  });
});
