import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { POST as collectRoute } from "@/app/api/collect/route";
import OgImage from "@/app/t/[id]/opengraph-image";
import { resetCollectState } from "@/lib/analytics";
import { withdrawConsent } from "@/lib/consent";
import { jsonLdText } from "@/lib/seo";
import { shareLinks, testimonialJsonLd, testimonialMetadata, testimonialPage } from "@/lib/testimonial-page";
import { createProject, createTestimonial, updateTestimonial } from "@/lib/testimonials";
import { useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  resetCollectState();
  process.env.PUBLIC_URL = "https://plaudit.example";
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  delete process.env.PUBLIC_URL;
  delete process.env.PLAUDIT_FEATURES;
  ctx.cleanup();
});

const approved = (text = "Best tool we bought this year </script><!--") => {
  const t = createTestimonial(projectId, { name: "Ada Lovelace", email: "ada@example.com", text, rating: 5, company: "Analytical Engines" });
  updateTestimonial(t.id, { status: "approved" });
  return t.id;
};
const og = (id: string) => OgImage({ params: Promise.resolve({ id }) });
const collect = (body: unknown) =>
  collectRoute(
    new Request("http://localhost/api/collect", {
      method: "POST",
      headers: { "content-type": "text/plain", "x-forwarded-for": "203.0.113.9", "user-agent": "Mozilla/5.0 (Macintosh) Safari/605.1.15" },
      body: JSON.stringify(body),
    }),
  );
const views = () => getDb().select().from(schema.analyticsEvents).all();

describe("WALL-04 single testimonial page", () => {
  it("WALL-04 shows an approved, consented testimonial with its person, a CTA and an absolute address", () => {
    const id = approved();
    const d = testimonialPage(id)!;
    expect(d.url).toBe(`https://plaudit.example/t/${id}`);
    expect(d.item).toMatchObject({ id, name: "Ada Lovelace", company: "Analytical Engines", rating: 5 });
    expect(d.wallUrl).toBe("/wall/acme");
    expect(d.formUrl).toBe("/c/acme");
    // Nothing private reaches the page's data.
    expect(JSON.stringify(d)).not.toContain("ada@example.com");
    const meta = testimonialMetadata(d);
    expect(meta.alternates?.canonical).toBe(d.url);
    expect(JSON.stringify(meta.openGraph)).toContain(`${d.url}/opengraph-image`);
  });

  it("WALL-04 is a 404 for pending, rejected, hidden, withdrawn, private-consent and made-up ids", () => {
    const pending = createTestimonial(projectId, { name: "P", text: "Pending" }).id;
    const hidden = approved();
    updateTestimonial(hidden, { status: "hidden" });
    const withdrawn = approved();
    withdrawConsent(withdrawn, { actor: "customer" });
    const priv = approved();
    // An archive import can carry an approved row whose author asked to keep it private (D11).
    getDb().update(schema.testimonials).set({ consentPublic: false }).where(eq(schema.testimonials.id, priv)).run();
    for (const id of [pending, hidden, withdrawn, priv, "00000000-0000-0000-0000-000000000000", "1", "../etc/passwd"]) {
      expect(testimonialPage(id), id).toBeNull();
    }
  });

  it("WALL-04 the link preview image is the quote for a public testimonial and a bare 404 otherwise", async () => {
    const id = approved();
    const res = await og(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    updateTestimonial(id, { status: "rejected" });
    const gone = await og(id);
    expect(gone.status).toBe(404);
    expect(await gone.text()).toBe("Not found");
    expect((await og("00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });

  it("WALL-04 follows the walls flag (D20)", async () => {
    const id = approved();
    process.env.PLAUDIT_FEATURES = "forms,widgets";
    expect((await og(id)).status).toBe(404);
  });

  it("WALL-04 SEO-03 JSON-LD names the project and carries the one review, escaped for a script block", () => {
    const d = testimonialPage(approved())!;
    const ld = testimonialJsonLd(d);
    expect(ld).toMatchObject({ "@type": "Product", name: "Acme", url: d.url, review: [{ "@type": "Review", author: { name: "Ada Lovelace" }, reviewRating: { ratingValue: 5 } }] });
    expect(ld).not.toHaveProperty("aggregateRating");
    const text = jsonLdText(ld);
    expect(text).not.toContain("</script>");
    expect(text).not.toContain("<!--");
  });

  it("WALL-04 SHARE-03 share links are the platforms' plain intent pages with the link and text encoded", () => {
    const links = shareLinks("https://plaudit.example/t/abc", "“Great” — Ada & co");
    expect(links.x).toBe("https://x.com/intent/post?text=%E2%80%9CGreat%E2%80%9D%20%E2%80%94%20Ada%20%26%20co&url=https%3A%2F%2Fplaudit.example%2Ft%2Fabc");
    expect(links.linkedin).toBe("https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fplaudit.example%2Ft%2Fabc");
    expect(links.email.startsWith("mailto:?")).toBe(true);
  });

  it("WALL-04 counts views and share clicks with the cookieless beacon, only for public pages", async () => {
    const id = approved();
    const hidden = approved();
    updateTestimonial(hidden, { status: "hidden" });
    expect((await collect({ t: "testimonial", id, k: "view" })).status).toBe(204);
    expect((await collect({ t: "testimonial", id, k: "share" })).status).toBe(204);
    expect((await collect({ t: "testimonial", id: hidden, k: "view" })).status).toBe(204);
    expect((await collect({ t: "testimonial", id, k: "delete" })).status).toBe(204);
    expect(views().map((e) => [e.objectType, e.objectId, e.metric])).toEqual([
      ["testimonial", id, "view"],
      ["testimonial", id, "share"],
    ]);
  });
});

