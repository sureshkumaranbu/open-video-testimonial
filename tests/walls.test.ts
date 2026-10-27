import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WallPage, { generateMetadata as legacyMeta } from "@/app/wall/[slug]/page";
import WallSlugPage, { generateMetadata as wallMeta } from "@/app/wall/[slug]/[wall]/page";
import OgImage from "@/app/wall/[slug]/[wall]/opengraph-image";
import { GET as itemsRoute } from "@/app/api/walls/[id]/items/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/admin/projects/[id]/walls/route";
import { DELETE as deleteRoute, PATCH as patchRoute } from "@/app/api/admin/walls/[id]/route";
import { POST as mainRoute } from "@/app/api/admin/walls/[id]/main/route";
import { POST as slugRoute } from "@/app/api/admin/walls/[id]/slug/route";
import { POST as imageRoute } from "@/app/api/admin/walls/[id]/image/route";
import { POST as previewRoute } from "@/app/api/admin/walls/[id]/preview/route";
import { inkFor } from "@/components/WallView";
import { contrastRatio } from "@/lib/contrast";
import { createForm } from "@/lib/forms";
import { THEME_COLOURS, WALL_THEMES } from "@/lib/wall-config";
import { createProject, createTestimonial, getProjectById, isMediaPublic, updateTestimonial } from "@/lib/testimonials";
import {
  changeWallSlug,
  createWall,
  defaultWallConfig,
  deleteWall,
  getMainWall,
  getWall,
  getWallBySlug,
  parseWallConfigLenient,
  resolveTab,
  setMainWall,
  updateWall,
  wallConfig,
  wallConfigSchema,
  wallItems,
  wallView,
} from "@/lib/walls";
import { adminHeaders, params, PNG_BYTES, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;
let clock = Date.UTC(2026, 0, 1);

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => ctx.cleanup());

const project = () => getProjectById(projectId)!;

function add(name: string, o: { rating?: number; tags?: string[]; status?: "approved" | "pending"; email?: string; text?: string } = {}) {
  clock += 60_000;
  const t = createTestimonial(projectId, { name, text: o.text ?? `${name} likes it`, rating: o.rating, email: o.email }, { createdAt: new Date(clock) });
  updateTestimonial(t.id, { status: o.status ?? "approved", ...(o.tags ? { tags: o.tags } : {}) });
  return t.id;
}

const page = <T,>(p: Record<string, string>, query: Record<string, string> = {}) => ({ params: Promise.resolve(p), searchParams: Promise.resolve(query) }) as T;

async function outcome(render: Promise<unknown>) {
  try {
    return { html: renderToStaticMarkup((await render) as ReactElement) };
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? "";
    const redirect = /^NEXT_REDIRECT;[^;]*;(.*);(\d{3});$/.exec(digest);
    if (redirect) return { redirect: redirect[1], status: Number(redirect[2]) };
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return { status: 404 };
    throw err;
  }
}

const json = (method: string, body: unknown) => ({ method, headers: { ...adminHeaders(), "content-type": "application/json" }, body: JSON.stringify(body) });
const req = (init?: RequestInit) => new Request("http://localhost/x", init);

/** The JSON inside the page's ld+json block. */
function ldJson(html: string) {
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  return m ? JSON.parse(m[1]) : null;
}

describe("wall config", () => {
  it("WALL-01 parses partial configs with defaults and keeps a bad section from breaking the rest", () => {
    const cfg = defaultWallConfig({ title: "Love" });
    expect(cfg.hero.title).toBe("Love");
    expect(cfg.layout).toEqual({ columns: 3, pagination: "load_more", pageSize: 12 });
    const lenient = parseWallConfigLenient({ hero: { title: 5 }, inlineCta: { enabled: true, after: 4 } });
    expect(lenient.hero.title).toBe("");
    expect(lenient.inlineCta).toMatchObject({ enabled: true, after: 4 });
    // Links are web addresses or paths on this server, never javascript: or protocol-relative.
    for (const url of ["javascript:alert(1)", "//evil.example", "/\\evil.example", "https://a.example\\@b", "data:text/html,x"])
      expect(wallConfigSchema.safeParse({ heroCta: { url } }).success, url).toBe(false);
    expect(wallConfigSchema.safeParse({ nav: Array.from({ length: 5 }, () => ({ label: "x", url: "/x" })) }).success).toBe(false);
    expect(wallConfigSchema.safeParse({ heroCta: { url: "https://acme.example/start" }, nav: [{ label: "Home", url: "/" }] }).success).toBe(true);
  });

  it("WALL-01 L5 the editor's theme colours match wall-view.css, and every theme's own text reads at 4.5:1", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../src/components/wall-view.css"), "utf8");
    const block = (theme: string) => {
      const m = theme === "paper" ? /\.wl-page \{([^}]*)\}/.exec(css) : new RegExp(`\\.wl-page\\[data-wall-theme="${theme}"\\] \\{([^}]*)\\}`).exec(css);
      return Object.fromEntries([...(m?.[1] ?? "").matchAll(/(--wl-[\w-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
    };
    const paper = block("paper");
    for (const theme of WALL_THEMES) {
      const v = { ...paper, ...block(theme) };
      const c = THEME_COLOURS[theme];
      expect(v["--wl-card"], theme).toBe(c.card);
      expect(v["--wl-card-ink"], theme).toBe(c.cardInk);
      expect(v["--wl-hero-ink"] === "var(--wl-ink)" ? v["--wl-ink"] : v["--wl-hero-ink"], theme).toBe(c.heroInk);
      const hero = v["--wl-hero-bg"] === "transparent" ? v["--wl-bg"] : v["--wl-hero-bg"];
      expect(hero.startsWith("#") ? hero : /#[0-9a-f]{6}/.exec(hero)![0], theme).toBe(c.heroBg);
      expect(v["--wl-cta-bg"] === "var(--accent)" ? null : v["--wl-cta-bg"], theme).toBe(c.ctaBg);
      expect(v["--wl-cta-ink"].startsWith("var(") ? null : v["--wl-cta-ink"], theme).toBe(c.ctaInk);
      expect(contrastRatio(c.cardInk, c.card)!, theme).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.heroInk, c.heroBg)!, theme).toBeGreaterThanOrEqual(4.5);
      if (c.ctaBg) expect(contrastRatio(c.ctaInk!, c.ctaBg)!, theme).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("WALL-01 L5 a background the owner picks gets readable text unless they pick the text too", () => {
    expect(inkFor("", "#ffffff")).toBe("#161b2e");
    expect(inkFor("", "#101010")).toBe("#ffffff");
    expect(inkFor("#ff0000", "#ffffff")).toBe("#ff0000");
    expect(inkFor("", "")).toBe("");
  });

  it("WALL-02 resolves the tab from ?tab= or the default tab", () => {
    const cfg = wallConfigSchema.parse({ tabs: { enabled: true, items: [{ label: "All" }, { label: "Pro", tag: "pro" }], defaultTab: 1 } });
    expect(resolveTab(cfg, undefined)).toBe(1);
    expect(resolveTab(cfg, "0")).toBe(0);
    expect(resolveTab(cfg, "9")).toBe(1);
    expect(resolveTab(cfg, "1; drop")).toBe(1);
    expect(resolveTab(defaultWallConfig(), "1")).toBe(0);
  });
});

describe("walls lib", () => {
  it("WALL-01 creates drafts with free slugs, renames links with redirects, and a live slug beats an alias", () => {
    const a = createWall(project(), { name: "Customer love" });
    expect(a).toMatchObject({ slug: "customer-love", published: false, isMain: false, theme: "paper" });
    expect(wallConfig(a).hero.title).toBe("What people say about Acme");
    expect(createWall(project(), { name: "Customer love" }).slug).toBe("customer-love-2");
    expect(() => createWall(project(), { name: "X", slug: "customer-love" })).toThrow(/already uses/);

    const moved = changeWallSlug(a.id, "love");
    expect(moved.wall.slug).toBe("love");
    expect(getWallBySlug(projectId, "customer-love")).toMatchObject({ wall: { id: a.id }, redirectedFrom: "customer-love" });
    // Another wall takes the old slug: the alias row goes (D17).
    const b = createWall(project(), { name: "Other" });
    expect(changeWallSlug(b.id, "customer-love").droppedAlias).toBe(true);
    expect(getWallBySlug(projectId, "customer-love")?.wall.id).toBe(b.id);
  });

  it("WALL-01 switching the main wall: one at a time, and only a published main replaces /wall/<project>", () => {
    const a = createWall(project(), { name: "A" });
    const b = createWall(project(), { name: "B" });
    setMainWall(projectId, a.id);
    expect(getMainWall(projectId)).toBeNull();
    updateWall(a.id, { published: true });
    expect(getMainWall(projectId)?.id).toBe(a.id);
    setMainWall(projectId, b.id);
    expect(getWall(a.id)?.isMain).toBe(false);
    expect(getWall(b.id)?.isMain).toBe(true);
    setMainWall(projectId, null);
    expect(getWall(b.id)?.isMain).toBe(false);
    const other = createProject({ name: "Other", slug: "other" });
    expect(() => setMainWall(other.id, a.id)).toThrow(/not found/i);
  });

  it("WALL-02 tabs filter by tag, pages load more, and only public rows count", () => {
    for (let i = 0; i < 7; i++) add(`P${i}`, { tags: i % 2 ? ["pro"] : [], rating: 5 });
    add("Hidden", { status: "pending", tags: ["pro"] });
    const w = updateWall(createWall(project(), { name: "W" }).id, {
      config: { layout: { pageSize: 3 }, tabs: { enabled: true, items: [{ label: "All" }, { label: "Pro", tag: "pro" }] } },
    })!;
    const first = wallItems(w, { tab: 0 });
    expect(first.items.map((t) => t.name)).toEqual(["P6", "P5", "P4"]);
    expect(first).toMatchObject({ total: 7, nextOffset: 3 });
    expect(wallItems(w, { tab: 0, offset: 6 })).toMatchObject({ total: 7, nextOffset: null, items: [{ name: "P0" }] });
    const pro = wallItems(w, { tab: 1 });
    expect(pro.total).toBe(3);
    expect(pro.items.every((t) => t.tags.includes("pro"))).toBe(true);
  });

  it("WALL-01 wall media is public only while the wall is published, and deleting removes it", async () => {
    const w = createWall(project(), { name: "W" });
    const res = await imageRoute(
      new Request(`http://localhost/x?kind=cover`, { method: "POST", headers: adminHeaders(), body: form("image", new File([PNG_BYTES], "c.png", { type: "image/png" })) }),
      params({ id: w.id }),
    );
    expect(res.status).toBe(200);
    const key = getWall(w.id)!.coverKey!;
    expect(key).toMatch(/^images\/.+\.png$/);
    expect(isMediaPublic(key)).toBe(false);
    updateWall(w.id, { published: true });
    expect(isMediaPublic(key)).toBe(true);
    updateWall(w.id, { published: false });
    expect(isMediaPublic(key)).toBe(false);
    const svg = await imageRoute(
      new Request(`http://localhost/x?kind=logo`, { method: "POST", headers: adminHeaders(), body: form("image", new File(["<svg/>"], "x.svg", { type: "image/svg+xml" })) }),
      params({ id: w.id }),
    );
    expect(svg.status).toBe(415);
    expect(await deleteWall(w.id)).toBe(true);
    expect(getWall(w.id)).toBeNull();
  });
});

function form(name: string, file: File) {
  const f = new FormData();
  f.set(name, file);
  return f;
}

describe("wall pages", () => {
  it("WALL-01 a draft wall is a 404, page, items and OG image alike; published it renders server-side", async () => {
    add("Ada", { rating: 5, email: "ada@private.example" });
    const w = createWall(project(), { name: "Love" });
    expect(await outcome(WallSlugPage(page({ slug: "acme", wall: "love" })))).toEqual({ status: 404 });
    expect((await itemsRoute(req(), params({ id: w.id }))).status).toBe(404);
    const draftImage = (await OgImage({ params: Promise.resolve({ slug: "acme", wall: "love" }) })) as Response;
    expect(draftImage.status).toBe(404);
    expect(await wallMeta(page({ slug: "acme", wall: "love" }))).toMatchObject({ robots: { index: false } });

    updateWall(w.id, { published: true });
    const { html } = (await outcome(WallSlugPage(page({ slug: "acme", wall: "love" })))) as { html: string };
    expect(html).toContain("What people say about Acme");
    expect(html).toContain("Ada likes it");
    expect(html).not.toContain("private.example");
    expect((await itemsRoute(req(), params({ id: w.id }))).status).toBe(200);
    const image = (await OgImage({ params: Promise.resolve({ slug: "acme", wall: "love" }) })) as Response;
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await image.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("WALL-01 old project and wall links answer 308 and keep the query", async () => {
    const w = updateWall(createWall(project(), { name: "Love" }).id, { published: true })!;
    changeWallSlug(w.id, "fans");
    expect(await outcome(WallSlugPage(page({ slug: "acme", wall: "love" }, { tab: "1" })))).toEqual({ redirect: "/wall/acme/fans?tab=1", status: 308 });
  });

  it("WALL-03 SEO-03 meta, canonical, noindex and escaped JSON-LD with at most 10 reviews", async () => {
    for (let i = 0; i < 12; i++) add(`Fan ${i}`, { rating: i % 2 ? 4 : 5, text: i === 11 ? "Best </script><script>alert(1)</script> tool" : undefined });
    add("Unrated");
    const w = updateWall(createWall(project(), { name: "Love" }).id, {
      published: true,
      config: { seo: { title: "Acme reviews", description: "Real words from real customers." }, hero: { title: "Loved by teams" } },
    })!;
    const meta = await wallMeta(page({ slug: "acme", wall: "love" }));
    expect(meta).toMatchObject({
      title: { absolute: "Acme reviews" },
      description: "Real words from real customers.",
      alternates: { canonical: "http://localhost:3000/wall/acme/love" },
      openGraph: { title: "Acme reviews", url: "http://localhost:3000/wall/acme/love" },
    });
    expect(meta.robots).toBeUndefined();
    const { html } = (await outcome(WallSlugPage(page({ slug: "acme", wall: "love" }, { tab: "0" })))) as { html: string };
    expect(html.match(/<\/script>/g)?.length).toBe(1);
    expect(html).not.toContain("<script>alert(1)");
    const ld = ldJson(html);
    expect(ld).toMatchObject({
      "@type": "Product",
      name: "Acme",
      url: "http://localhost:3000/wall/acme/love",
      aggregateRating: { "@type": "AggregateRating", ratingCount: 12, ratingValue: 4.5 },
    });
    expect(ld.review).toHaveLength(10);
    expect(JSON.stringify(ld)).toContain("Best </script><script>alert(1)</script> tool");

    updateWall(w.id, { config: { ...wallConfig(w), seo: { ...wallConfig(w).seo, noindex: true } } });
    expect((await wallMeta(page({ slug: "acme", wall: "love" }))).robots).toEqual({ index: false, follow: true });
    // As the main wall, the canonical is the project's wall address.
    setMainWall(projectId, w.id);
    expect((await wallMeta(page({ slug: "acme", wall: "love" }))).alternates).toEqual({ canonical: "http://localhost:3000/wall/acme" });
  });

  it("WALL-01 legacy /wall/<project> is unchanged until a published wall is marked main, and gains JSON-LD", async () => {
    add("Ada", { rating: 5 });
    const legacy = (await outcome(WallPage(page({ slug: "acme" })))) as { html: string };
    expect(legacy.html).toContain('class="wall-page"');
    expect(ldJson(legacy.html)).toMatchObject({ "@type": "Product", name: "Acme", aggregateRating: { ratingCount: 1 } });
    expect(await legacyMeta(page({ slug: "acme" }))).toMatchObject({ title: "What people say about Acme", alternates: { canonical: "http://localhost:3000/wall/acme" } });

    const w = createWall(project(), { name: "Love" });
    setMainWall(projectId, w.id);
    expect(((await outcome(WallPage(page({ slug: "acme" })))) as { html: string }).html).toContain('class="wall-page"');
    updateWall(w.id, { published: true, config: { hero: { title: "Our main wall" } } });
    const main = (await outcome(WallPage(page({ slug: "acme" })))) as { html: string };
    expect(main.html).toContain("wl-page");
    expect(main.html).toContain("Our main wall");
    expect(await legacyMeta(page({ slug: "acme" }))).toMatchObject({
      alternates: { canonical: "http://localhost:3000/wall/acme" },
      openGraph: { images: [{ url: "http://localhost:3000/wall/acme/love/opengraph-image" }] },
    });
    await deleteWall(w.id);
    expect(((await outcome(WallPage(page({ slug: "acme" })))) as { html: string }).html).toContain('class="wall-page"');
  });

  it("WALL-02 tabs and the inline CTA after N cards render in the server HTML", async () => {
    for (let i = 0; i < 8; i++) add(`P${i}`, { tags: i < 3 ? ["pro"] : [] });
    const form = createForm(projectId, { name: "Stories" });
    updateWall(createWall(project(), { name: "Love" }).id, {
      published: true,
      connectedFormId: form.id,
      config: {
        tabs: { enabled: true, items: [{ label: "Everyone" }, { label: "Pros", tag: "pro" }] },
        inlineCta: { enabled: true, after: 6, title: "Your turn" },
        layout: { pageSize: 12 },
      },
    });
    const { html } = (await outcome(WallSlugPage(page({ slug: "acme", wall: "love" })))) as { html: string };
    expect(html).toContain('href="/wall/acme/love?tab=1"');
    expect(html).toMatch(/aria-current="page"[^>]*>Everyone</);
    const cards = [...html.matchAll(/data-testimonial-id="|data-testid="wall-inline-cta"/g)].map((m) => (m[0].includes("cta") ? "cta" : "card"));
    expect(cards.indexOf("cta")).toBe(6);
    expect(html).toContain(`href="/f/acme/${form.slug}"`);
    const pros = (await outcome(WallSlugPage(page({ slug: "acme", wall: "love" }, { tab: "1" })))) as { html: string };
    expect(pros.html.match(/data-testimonial-id=/g)).toHaveLength(3);
  });
});

describe("walls admin API", () => {
  it("WALL-01 create, edit, publish, main, slug, preview and delete", async () => {
    add("Ada", { rating: 5 });
    const created = await createRoute(req(json("POST", { name: "Fans" })), params({ id: projectId }));
    expect(created.status).toBe(201);
    const { wall } = await created.json();
    expect(wall).toMatchObject({ slug: "fans", published: false, url: "/wall/acme/fans", publicUrl: "/wall/acme/fans" });
    const bad = await patchRoute(req(json("PATCH", { config: { heroCta: { url: "javascript:alert(1)" } } })), params({ id: wall.id }));
    expect(bad.status).toBe(400);
    const patched = await patchRoute(req(json("PATCH", { published: true, theme: "night", config: { hero: { title: "Hi" } } })), params({ id: wall.id }));
    expect((await patched.json()).wall).toMatchObject({ published: true, theme: "night", config: { hero: { title: "Hi" } } });
    const foreign = createTestimonial(createProject({ name: "Other", slug: "other" }).id, { name: "Them", text: "x" });
    expect((await patchRoute(req(json("PATCH", { featuredTestimonialId: foreign.id })), params({ id: wall.id }))).status).toBe(400);

    const main = await mainRoute(req(json("POST", { main: true })), params({ id: wall.id }));
    expect((await main.json()).wall).toMatchObject({ isMain: true, publicUrl: "/wall/acme" });
    const slug = await slugRoute(req(json("POST", { slug: "Not Valid!" })), params({ id: wall.id }));
    expect(slug.status).toBe(400);

    const preview = await previewRoute(req(json("POST", { config: { hero: { title: "Unsaved" } }, theme: "sunrise" })), params({ id: wall.id }));
    expect(preview.headers.get("cache-control")).toBe("no-store");
    const { view } = await preview.json();
    expect(view).toMatchObject({ wall: { theme: "sunrise", config: { hero: { title: "Unsaved" } } }, total: 1 });
    expect(JSON.stringify(view)).not.toMatch(/email/i);

    const list = await (await listRoute(req({ headers: adminHeaders() }), params({ id: projectId }))).json();
    expect(list.walls).toHaveLength(1);
    expect((await createRoute(req({ method: "POST", body: "{}" }), params({ id: projectId }))).status).toBe(401);
    expect((await deleteRoute(req({ method: "DELETE", headers: adminHeaders() }), params({ id: wall.id }))).status).toBe(200);
    expect((await deleteRoute(req({ method: "DELETE", headers: adminHeaders() }), params({ id: wall.id }))).status).toBe(404);
  });

  it("WALL-01 the public view never carries private fields", () => {
    add("Ada", { rating: 5, email: "ada@private.example" });
    const w = createWall(project(), { name: "W" });
    const v = wallView(w, project(), { path: "/wall/acme/w" });
    expect(JSON.stringify(v)).not.toContain("private.example");
    expect(JSON.stringify(v)).not.toMatch(/"[^"]*email[^"]*":/i);
  });
});
