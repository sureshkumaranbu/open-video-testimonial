import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as html } from "@/app/api/widget/[slug]/html/route";
import { createProject, createTestimonial, updateTestimonial } from "@/lib/testimonials";
import { escapeHtml, jsonLdSafe, renderWidgetHtml } from "@/lib/widget-html";
import { createWidget, defaultWidgetConfig, deleteWidget, toPublicWidget } from "@/lib/widgets";
import type { FeedItem } from "@/lib/widget-config";
import { params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => ctx.cleanup());

const project = { name: "Acme </script><script>alert(1)</script>", slug: "acme", accentColor: "#0f766e" };

function item(o: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "t1",
    name: "Ada",
    title: null,
    company: null,
    avatarUrl: null,
    rating: 5,
    text: "Fine",
    video: null,
    tags: [],
    createdAt: "2026-01-02T00:00:00.000Z",
    extra: {
      headline: null,
      date: "2026-01-02T00:00:00.000Z",
      datePrecision: "day",
      platform: null,
      sourceUrl: null,
      verified: false,
      images: [],
      companyLogoUrl: null,
      highlights: [],
    },
    ...o,
  };
}

const pub = (layout: Parameters<typeof defaultWidgetConfig>[0] = "grid") =>
  toPublicWidget({ id: "w_abcdefabcdef" }, defaultWidgetConfig(layout), { cta: null, wallUrl: "/wall/acme" });

describe("renderWidgetHtml", () => {
  it("DISP-10 escapes </script> and <img onerror> in every field", () => {
    const evil = `</script><img src=x onerror="alert(1)">`;
    const out = renderWidgetHtml(
      pub(),
      project,
      [item({ name: evil, text: evil, title: evil, company: evil, extra: { ...item().extra, headline: evil, date: evil } })],
      { count: 1, average: 5 },
      { jsonLd: true, origin: "https://plaudit.example" },
    );
    expect(out).not.toContain("<img src=x");
    expect(out).not.toContain('onerror="');
    // The only </script> is the JSON-LD block's own closing tag.
    expect(out.match(/<\/script>/g)).toHaveLength(1);
    expect(out).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("DISP-10 JSON-LD can't break out of its script tag", () => {
    const data = jsonLdSafe({ a: "</script><b>&", b: "\u2028\u2029" });
    expect(data).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(data)).toEqual({ a: "</script><b>&", b: "\u2028\u2029" });
    const out = renderWidgetHtml(pub(), project, [item()], { count: 1, average: 5 }, { jsonLd: true, origin: "" });
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*)<\/script>/.exec(out)![1]);
    expect(ld).toMatchObject({ "@type": "Organization", aggregateRating: { ratingValue: 5, reviewCount: 1 }, review: [{ reviewBody: "Fine" }] });
    expect(escapeHtml(`<"'&>`)).toBe("&lt;&quot;&#39;&amp;&gt;");
  });

  it("DISP-10 only http(s) source links, and media links made absolute", () => {
    const out = renderWidgetHtml(
      pub(),
      project,
      [item({ extra: { ...item().extra, sourceUrl: "https://g.example/r/1", platform: "google", images: [{ url: "/api/media/images/x.png", alt: null }] } })],
      { count: 1, average: 5 },
      { jsonLd: false, origin: "https://plaudit.example" },
    );
    expect(out).toContain('href="https://g.example/r/1"');
    expect(out).toContain('src="https://plaudit.example/api/media/images/x.png"');
    expect(out).not.toContain("ld+json");
  });
});

describe("GET /api/widget/w_…/html", () => {
  it("DISP-10 serves the review text as cross-origin HTML", async () => {
    const t = createTestimonial(projectId, { name: "Ada", email: "ada@example.com", text: "Readable <b>without</b> JavaScript", rating: 5 });
    updateTestimonial(t.id, { status: "approved" });
    const w = createWidget(projectId, { name: "W", layout: "marquee" });
    const res = await html(new Request(`http://localhost/api/widget/${w.id}/html?jsonld=1`), params({ slug: w.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toContain("max-age=60");
    const body = await res.text();
    expect(body).toContain("Readable &lt;b&gt;without&lt;/b&gt; JavaScript");
    expect(body).toContain('class="list"');
    expect(body).toContain("application/ld+json");
    expect(body).not.toContain("ada@example.com");
  });

  it("DISP-10 a deleted widget gives an empty fragment; an unknown one 404s", async () => {
    const w = createWidget(projectId, { name: "W", layout: "grid" });
    deleteWidget(w.id);
    const res = await html(new Request(`http://localhost/api/widget/${w.id}/html`), params({ slug: w.id }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect((await html(new Request("http://localhost/api/widget/acme/html"), params({ slug: "acme" }))).status).toBe(404);
  });
});
