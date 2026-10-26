import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as schemaJs, OPTIONS as schemaOptions } from "@/app/schema/[file]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/admin/projects/[id]/seo-snippets/route";
import { DELETE as deleteRoute, PATCH as patchRoute } from "@/app/api/admin/seo-snippets/[id]/route";
import { SEO_SCHEMA_TYPES as DB_TYPES } from "@/db/schema";
import { createForm } from "@/lib/forms";
import { ratingSummary } from "@/lib/public-feed";
import { jsonLdScript, jsonLdText, reviewJsonLd, SEO_SCHEMA_TYPES, seoGuidance, snippetJs } from "@/lib/seo";
import { createSnippet, newSnippetId, SNIPPET_ID, snippetData, snippetToAdmin, updateSnippet } from "@/lib/seo-snippets";
import { createProject, createTestimonial, getProjectById, updateTestimonial } from "@/lib/testimonials";
import type { FeedItem } from "@/lib/widget-config";
import { adminHeaders, params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;
let clock = Date.UTC(2026, 0, 1);

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => ctx.cleanup());

function add(name: string, o: { rating?: number; text?: string; tags?: string[]; status?: "approved" | "pending"; formId?: string; email?: string } = {}) {
  clock += 60_000;
  const t = createTestimonial(
    projectId,
    { name, text: o.text ?? `${name} likes it`, rating: o.rating, email: o.email, ...(o.formId ? { formId: o.formId } : {}) },
    { createdAt: new Date(clock) },
  );
  updateTestimonial(t.id, { status: o.status ?? "approved", ...(o.tags ? { tags: o.tags } : {}) });
  return t.id;
}

function item(i: number, o: Partial<FeedItem> = {}): FeedItem {
  return {
    id: `t${i}`,
    name: `Person ${i}`,
    title: null,
    company: null,
    avatarUrl: null,
    rating: 5,
    text: `Review ${i}`,
    video: null,
    tags: [],
    createdAt: "2026-01-02T00:00:00.000Z",
    extra: {
      headline: null,
      date: "2026-01-02T10:00:00.000Z",
      datePrecision: "day",
      platform: null,
      sourceUrl: null,
      verified: true,
      images: [],
      companyLogoUrl: null,
      highlights: [],
    },
    ...o,
  };
}

const json = (method: string, body: unknown) => ({
  method,
  headers: { ...adminHeaders(), "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("seo lib", () => {
  it("SEO-01 builds valid Review data: the reviewed thing, at most 10 reviews, an AggregateRating", () => {
    expect(SEO_SCHEMA_TYPES).toEqual(DB_TYPES);
    const items = Array.from({ length: 14 }, (_, i) => item(i, i === 3 ? { extra: { ...item(3).extra, headline: "Great" } } : {}));
    const data = reviewJsonLd({ type: "Product", name: "Acme Pro", url: "https://acme.test/pro", items, aggregate: { count: 14, average: 4.86 } });
    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Acme Pro",
      url: "https://acme.test/pro",
      aggregateRating: { "@type": "AggregateRating", ratingValue: 4.9, ratingCount: 14, bestRating: 5, worstRating: 1 },
    });
    expect(data.review).toHaveLength(10);
    expect(data.review![0]).toEqual({
      "@type": "Review",
      author: { "@type": "Person", name: "Person 0" },
      reviewBody: "Review 0",
      datePublished: "2026-01-02",
      reviewRating: { "@type": "Rating", ratingValue: 5, bestRating: 5, worstRating: 1 },
    });
    expect(data.review![3]).toMatchObject({ name: "Great" });
    // A javascript: link is never written as the url.
    expect(reviewJsonLd({ type: "Product", name: "X", url: "javascript:alert(1)", items: [], aggregate: { count: 0, average: null } })).not.toHaveProperty("url");
  });

  it("SEO-01 adds aggregateRating only when at least one review is rated, and skips reviews without words", () => {
    const none = reviewJsonLd({ type: "Organization", name: "Acme", items: [item(1, { rating: null })], aggregate: { count: 0, average: null } });
    expect(none).not.toHaveProperty("aggregateRating");
    expect(none.review).toHaveLength(1);
    expect(none.review![0]).not.toHaveProperty("reviewRating");
    const one = reviewJsonLd({ type: "Organization", name: "Acme", items: [], aggregate: { count: 1, average: 4 } });
    expect(one.aggregateRating).toMatchObject({ ratingValue: 4, ratingCount: 1 });
    expect(one).not.toHaveProperty("review");
    const silent = reviewJsonLd({ type: "Course", name: "C", items: [item(1, { text: "  " })], aggregate: { count: 0, average: null } });
    expect(silent).not.toHaveProperty("review");
  });

  it("SEO-03 escapes </script>, <!--, & and U+2028/2029 so a review can't leave the JSON-LD block", () => {
    const evil = item(1, { name: "</script><script>alert(1)</script>", text: "a <!-- b & c \u2028 d \u2029" });
    const html = jsonLdScript(reviewJsonLd({ type: "Product", name: "</SCRIPT>x", items: [evil], aggregate: { count: 1, average: 5 } }));
    const inner = html.slice('<script type="application/ld+json">'.length, -"</script>".length);
    expect(inner).not.toMatch(/[<>&\u2028\u2029]/);
    expect(html.match(/<\/script>/gi)).toHaveLength(1);
    expect(JSON.parse(inner).review[0].author.name).toBe("</script><script>alert(1)</script>");
    expect(JSON.parse(inner).name).toBe("</SCRIPT>x");
    expect(jsonLdText({ a: "\u2028" })).toBe('{"a":"\\u2028"}');
  });

  it("SEO-01 the dynamic script injects the data once and carries it as an inert string", () => {
    const obj = { "@context": "https://schema.org", "@type": "Product", name: '"; alert(1); "</script>' };
    const js = snippetJs("s_abcdefabcdef", obj);
    const added: { type?: string; text?: string; attrs: Record<string, string> }[] = [];
    const fakeDoc = {
      head: { appendChild: (n: (typeof added)[number]) => added.push(n) },
      querySelectorAll: () => added.map((n) => ({ getAttribute: (k: string) => n.attrs[k] })),
      createElement: () => {
        const n: (typeof added)[number] = { attrs: {} };
        return Object.assign(n, { setAttribute: (k: string, v: string) => (n.attrs[k] = v) });
      },
    };
    new Function("document", js)(fakeDoc);
    new Function("document", js)(fakeDoc);
    expect(added).toHaveLength(1);
    expect(added[0].type).toBe("application/ld+json");
    expect(added[0].attrs["data-plaudit-schema"]).toBe("s_abcdefabcdef");
    expect(JSON.parse(added[0].text!)).toEqual(obj);
    expect(js).not.toContain("</script>");
  });

  it("SEO-02 guidance warns below 5 reviews and when nothing is rated", () => {
    const few = seoGuidance({ reviews: 3, rated: 0, type: "Organization" });
    expect(few.filter((g) => g.level === "warn").map((g) => g.text)).toEqual([
      expect.stringContaining("at least 5"),
      expect.stringContaining("star rating"),
    ]);
    expect(few.some((g) => /home page/.test(g.text))).toBe(true);
    expect(few.some((g) => /decides/.test(g.text))).toBe(true);
    expect(seoGuidance({ reviews: 5, rated: 5, type: "Product" }).filter((g) => g.level === "warn")).toEqual([]);
  });
});

describe("seo snippets", () => {
  it("SEO-01 ids are s_ plus 12 base36 characters", () => {
    const ids = new Set(Array.from({ length: 100 }, newSnippetId));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(SNIPPET_ID);
  });

  it("SEO-01 scope picks all, some tags or one form, and only public rows count", () => {
    const form = createForm(projectId, { name: "Events" });
    add("Ada", { rating: 5, tags: ["pro"], email: "ada@private.example" });
    add("Bo", { rating: 3 });
    add("Cy", { tags: ["pro"] });
    add("Di", { rating: 4, formId: form.id });
    add("Pending", { rating: 1, status: "pending", tags: ["pro"] });
    const project = getProjectById(projectId)!;

    const all = createSnippet(project, { name: "All" });
    const d = snippetData(all, project);
    expect(d.reviews).toBe(4);
    expect(d.rated).toEqual({ count: 3, average: 4 });
    expect(d.jsonLd).toMatchObject({ name: "Acme", aggregateRating: { ratingValue: 4, ratingCount: 3 } });
    expect(JSON.stringify(d.jsonLd)).not.toContain("private.example");

    const pro = createSnippet(project, { name: "Pro", scope: { mode: "tags", tags: ["Pro"] } });
    expect(snippetData(pro, project)).toMatchObject({ reviews: 2, rated: { count: 1, average: 5 } });
    const byForm = createSnippet(project, { name: "Form", schemaType: "Course", scope: { mode: "form", formId: form.id } });
    expect(snippetData(byForm, project)).toMatchObject({ reviews: 1, jsonLd: { "@type": "Course" } });
    expect(ratingSummary(projectId, { tags: ["pro"] })).toEqual({ count: 1, average: 5 });

    expect(() => createSnippet(project, { name: "Bad", scope: { mode: "tags", tags: [] } })).toThrow(/tag/);
    const other = createProject({ name: "Other", slug: "other" });
    const foreign = createForm(other.id, { name: "Theirs" });
    expect(() => createSnippet(project, { name: "Bad", scope: { mode: "form", formId: foreign.id } })).toThrow(/project's forms/);
    expect(() => updateSnippet(all.id, { item: { url: "javascript:alert(1)" } })).toThrow(/https/);
  });

  it("SEO-01 the admin view has static and dynamic code; the routes create, edit and delete", async () => {
    add("Ada", { rating: 5 });
    const res = await createRoute(
      new Request("http://localhost/x", json("POST", { name: "Pricing", schemaType: "SoftwareApplication", item: { name: "Acme App", url: "https://acme.test/app" } })),
      params({ id: projectId }),
    );
    expect(res.status).toBe(201);
    const { snippet } = await res.json();
    expect(snippet.id).toMatch(SNIPPET_ID);
    expect(snippet.codes.dynamic).toBe(`<script src="http://localhost:3000/schema/${snippet.id}.js" async></script>`);
    expect(snippet.codes.static).toMatch(/^<script type="application\/ld\+json">\n\{/);
    expect(JSON.parse(snippet.codes.static.replace(/^<script[^>]*>|<\/script>$/g, ""))).toMatchObject({ "@type": "SoftwareApplication", name: "Acme App" });
    expect(snippet.guidance.some((g: { level: string }) => g.level === "warn")).toBe(true);

    const list = await (await listRoute(new Request("http://localhost/x", { headers: adminHeaders() }), params({ id: projectId }))).json();
    expect(list.snippets).toHaveLength(1);
    const patched = await patchRoute(new Request("http://localhost/x", json("PATCH", { name: "Renamed", schemaType: "Product" })), params({ id: snippet.id }));
    expect((await patched.json()).snippet).toMatchObject({ name: "Renamed", schemaType: "Product" });
    const bad = await createRoute(new Request("http://localhost/x", json("POST", { name: "" })), params({ id: projectId }));
    expect(bad.status).toBe(400);
    const anon = await createRoute(new Request("http://localhost/x", { method: "POST", body: "{}" }), params({ id: projectId }));
    expect(anon.status).toBe(401);
    expect((await deleteRoute(new Request("http://localhost/x", { method: "DELETE", headers: adminHeaders() }), params({ id: snippet.id }))).status).toBe(200);
    expect((await deleteRoute(new Request("http://localhost/x", { method: "DELETE", headers: adminHeaders() }), params({ id: snippet.id }))).status).toBe(404);
  });

  it("SEO-01 the snippet JS route sends CORS, JavaScript and a 5-minute cache, and a harmless 404", async () => {
    add("Ada", { rating: 5, text: "Love </script> it" });
    const project = getProjectById(projectId)!;
    const s = createSnippet(project, { name: "Home" });
    const res = await schemaJs(new Request("http://localhost/x"), params({ file: `${s.id}.js` }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const js = await res.text();
    expect(js).toContain("application/ld+json");
    expect(js).not.toContain("</script>");
    expect(js).toBe(snippetJs(s.id, snippetToAdmin(s, project, "http://x").jsonLd));

    for (const file of [s.id, "s_000000000000.js", "../etc.js", `${s.id}.json`]) {
      const missing = await schemaJs(new Request("http://localhost/x"), params({ file }));
      expect(missing.status).toBe(404);
      expect(missing.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(await missing.text()).toMatch(/^\/\*.*\*\/\n$/);
    }
    expect(schemaOptions().headers.get("access-control-allow-origin")).toBe("*");
  });
});
