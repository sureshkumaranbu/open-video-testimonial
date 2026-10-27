import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WallSlugPage, { generateMetadata as wallMeta } from "@/app/wall/[slug]/[wall]/page";
import { DELETE as imageDelete, POST as imageRoute } from "@/app/api/admin/walls/[id]/image/route";
import { PATCH as patchRoute } from "@/app/api/admin/walls/[id]/route";
import { publicCsp } from "@/lib/csp";
import { sniffMime } from "@/lib/storage";
import { createProject, getProjectById, isMediaPublic } from "@/lib/testimonials";
import { wallCspExtra } from "@/lib/wall-head";
import { analyticsCspHosts, createWall, getWall, updateWall, wallConfig, wallHeadSchema } from "@/lib/walls";
import { proxy } from "@/proxy";
import { adminHeaders, params, PNG_BYTES, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  process.env.PUBLIC_URL = "https://plaudit.example";
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  delete process.env.PUBLIC_URL;
  ctx.cleanup();
});

const ICO = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 0x68, 4, 0, 0, 0x16, 0, 0, 0]);
const wall = (head?: Record<string, unknown>) => {
  const w = createWall(getProjectById(projectId)!, { name: "Love", config: head ? { head } : undefined });
  updateWall(w.id, { published: true });
  return getWall(w.id)!;
};
const upload = (id: string, bytes: Uint8Array<ArrayBuffer> | string, name = "f.png") => {
  const body = new FormData();
  body.set("image", new File([bytes], name));
  return imageRoute(new Request(`http://localhost/x?kind=favicon`, { method: "POST", headers: adminHeaders(), body }), params({ id }));
};
const cspOf = async (path: string) => proxy(new NextRequest(`https://plaudit.example${path}`)).headers.get("content-security-policy") ?? "";

describe("WALL-07 head options", () => {
  it("WALL-07 favicons are sniffed PNG or ICO, capped, public only while the wall is published, and fall back to the project logo", async () => {
    const w = wall();
    expect(sniffMime(ICO.subarray(0, 16))).toBe("image/x-icon");
    expect((await upload(w.id, '<svg xmlns="http://www.w3.org/2000/svg"/>', "f.svg")).status).toBe(415);
    expect((await upload(w.id, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "f.jpg")).status).toBe(415);
    expect((await upload(w.id, new Uint8Array(600 * 1024).fill(0x89, 0, 1), "big.png")).status).toBe(400);
    const ico = await upload(w.id, ICO, "favicon.ico");
    expect(ico.status).toBe(200);
    const key = getWall(w.id)!.faviconKey!;
    expect(key).toMatch(/^images\/.+\.ico$/);
    expect(isMediaPublic(key)).toBe(true);
    updateWall(w.id, { published: false });
    expect(isMediaPublic(key)).toBe(false);
    updateWall(w.id, { published: true });
    const meta = await wallMeta({ params: Promise.resolve({ slug: "acme", wall: w.slug }) } as never);
    expect(JSON.stringify(meta.icons)).toContain(`/api/media/${key}`);
    expect((await upload(w.id, PNG_BYTES)).status).toBe(200);
    await imageDelete(new Request(`http://localhost/x?kind=favicon`, { method: "DELETE", headers: adminHeaders() }), params({ id: w.id }));
    expect(getWall(w.id)!.faviconKey).toBeNull();
  });

  it("WALL-07 takes only validated values: a domain, a G- measurement ID, token-only verification codes", () => {
    const ok = wallHeadSchema.parse({ analytics: "ga4", ga4Id: "g-abc123def4", plausibleDomain: "Example.COM", googleVerification: "abc_DEF-123" });
    expect(ok).toMatchObject({ ga4Id: "G-ABC123DEF4", plausibleDomain: "example.com" });
    for (const bad of [
      { ga4Id: "UA-12345-1" },
      { ga4Id: 'G-ABC"><script>' },
      { ga4Id: "G-ABC" },
      { plausibleDomain: "example.com/<script>" },
      { plausibleDomain: "https://example.com" },
      { googleVerification: 'abc" onload="x' },
      { bingVerification: "<meta>" },
      { facebookVerification: "a b" },
      { analytics: "custom" },
    ]) {
      expect(wallHeadSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("WALL-07 renders the provider's script and the verification tags, and nothing when none is set", async () => {
    const plain = wall();
    const ga = createWall(getProjectById(projectId)!, { name: "Ga", config: { head: { analytics: "ga4", ga4Id: "G-ABC123DEF4", googleVerification: "tok_1", bingVerification: "B1", facebookVerification: "fb1" } } });
    updateWall(ga.id, { published: true });
    const html = async (slug: string) => renderToStaticMarkup((await WallSlugPage({ params: Promise.resolve({ slug: "acme", wall: slug }), searchParams: Promise.resolve({}) })) as ReactElement);
    expect(await html(plain.slug)).not.toMatch(/googletagmanager|plausible/);
    const page = await html(ga.slug);
    expect(page).toContain('src="https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4"');
    expect(page).toContain('gtag("config","G-ABC123DEF4")');
    const meta = await wallMeta({ params: Promise.resolve({ slug: "acme", wall: ga.slug }) } as never);
    expect(meta.verification).toEqual({ google: "tok_1", other: { "msvalidate.01": "B1", "facebook-domain-verification": "fb1" } });
  });

  it("WALL-07 a wall's CSP allows exactly its provider's hosts, and only that wall's", async () => {
    const base = publicCsp();
    const plain = wall();
    const pl = createWall(getProjectById(projectId)!, { name: "Pl", config: { head: { analytics: "plausible", plausibleDomain: "example.com" } } });
    updateWall(pl.id, { published: true });
    expect(await cspOf(`/wall/acme/${plain.slug}`)).toBe(base);
    const csp = await cspOf(`/wall/acme/${pl.slug}`);
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://plausible.io");
    expect(csp).toContain("connect-src 'self' https://plausible.io");
    expect(csp).not.toContain("googletagmanager");
    // A provider chosen without its value loads nothing, so it opens nothing.
    expect(analyticsCspHosts(wallHeadSchema.parse({ analytics: "ga4" })).script).toEqual([]);
    // The main wall's address follows the main wall; drafts and unknown walls get the plain policy.
    expect(await cspOf("/wall/acme")).toBe(base);
    updateWall(pl.id, { published: false });
    expect(wallCspExtra(`/wall/acme/${pl.slug}`)).toBeUndefined();
    expect(await cspOf("/wall/nope/x")).toBe(base);
    // Saving through the API validates too.
    const res = await patchRoute(
      new Request("http://localhost/x", { method: "PATCH", headers: { ...adminHeaders(), "content-type": "application/json" }, body: JSON.stringify({ config: { ...wallConfig(plain), head: { analytics: "ga4", ga4Id: "nope" } } }) }),
      params({ id: plain.id }),
    );
    expect(res.status).toBe(400);
  });
});
