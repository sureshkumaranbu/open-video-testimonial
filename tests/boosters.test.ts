import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as placesRoute } from "@/app/api/admin/boosters/google-places/route";
import { PATCH as patchRoute } from "@/app/api/admin/boosters/[id]/route";
import { GET as clicksRoute } from "@/app/api/admin/boosters/[id]/clicks/route";
import { POST as createRoute } from "@/app/api/admin/projects/[id]/boosters/route";
import { GET as pageRoute } from "@/app/b/[project]/[booster]/route";
import { GET as goRoute } from "@/app/b/[project]/[booster]/go/[link]/route";
import { getDb, schema } from "@/db";
import { logoBox, qrMatrix, qrSvg, QR_SIZES } from "@/components/admin/qr";
import {
  boosterLinksSchema,
  boosterPatchBody,
  changeBoosterSlug,
  clickStats,
  createBooster,
  getBooster,
  googleReviewLink,
  isHttpUrl,
  MAX_BOOSTER_LINKS,
  updateBooster,
  type BoosterLink,
} from "@/lib/boosters";
import { createForm, updateForm } from "@/lib/forms";
import { searchPlaces } from "@/lib/google-places";
import { changeProjectSlug } from "@/lib/projects";
import { resetRateLimits } from "@/lib/rate-limit";
import { createProject, getProjectById, isMediaPublic } from "@/lib/testimonials";
import { adminHeaders, params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  resetRateLimits();
  projectId = createProject({ name: "Acme Bakery", slug: "acme" }).id;
});
afterEach(() => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  vi.restoreAllMocks();
  ctx.cleanup();
});

const link = (id: string, platform: BoosterLink["platform"], url = `https://example.com/${id}`): BoosterLink => ({ id, platform, label: "", url, formId: null });

function publicBooster(links: BoosterLink[], o: { title?: string; message?: string } = {}) {
  const b = createBooster(getProjectById(projectId)!, { name: "Reviews" });
  return updateBooster(b.id, { links, published: true, ...o })!;
}

const page = (path: string, ip = "203.0.113.9") => {
  const [, , project, booster] = path.split("?")[0].split("/");
  return pageRoute(new Request(`http://localhost${path}`, { headers: { "x-forwarded-for": ip } }), params({ project, booster }));
};
const go = (projectSlug: string, booster: string, linkId: string, query = "", ip = "203.0.113.9") =>
  goRoute(new Request(`http://localhost/b/${projectSlug}/${booster}/go/${linkId}${query}`, { headers: { "x-forwarded-for": ip } }), params({ project: projectSlug, booster, link: linkId }));
const patch = (id: string, body: object) =>
  patchRoute(new Request(`http://localhost/api/admin/boosters/${id}`, { method: "PATCH", headers: adminHeaders(), body: JSON.stringify(body) }), params({ id }));

describe("booster editor and page (BOOST-01)", () => {
  it("BOOST-01 a new booster is a draft (404 in public) with our wording, and becomes public with its links in order", async () => {
    const res = await createRoute(new Request("http://localhost", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ name: "Leave a review" }) }), params({ id: projectId }));
    expect(res.status).toBe(201);
    const { booster } = await res.json();
    expect(booster).toMatchObject({ slug: "leave-a-review", published: false, title: "Enjoying Acme Bakery?", links: [] });
    expect(booster.url).toMatch(/\/b\/acme\/leave-a-review$/);
    expect((await page("/b/acme/leave-a-review")).status).toBe(404);

    const saved = await patch(booster.id, {
      links: [link("g", "google"), link("t", "trustpilot"), { ...link("c", "custom"), label: "Our guestbook" }],
      published: true,
      design: { background: "#fff7ed", button: "#9a3412", buttonStyle: "outline", radius: 20, showLogo: true, text: "", buttonText: "" },
    });
    expect(saved.status).toBe(200);
    const html = await (await page("/b/acme/leave-a-review")).text();
    expect([...html.matchAll(/data-platform="([a-z]+)"/g)].map((m) => m[1])).toEqual(["google", "trustpilot", "custom"]);
    expect(html).toContain("Review us on Google");
    expect(html).toContain("Our guestbook");
    expect(html).toContain('href="/b/acme/leave-a-review/go/g"');
    expect(html).toContain("border-radius:20px");
  });

  it("BOOST-01 up to 10 links, http(s) only: javascript:, data: and look-alikes are refused by the schema and the API", async () => {
    const b = createBooster(getProjectById(projectId)!, { name: "Reviews" });
    for (const url of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,hi", "//evil.example", "https://user:pw@example.com/x", "ftp://example.com/x", "https://"]) {
      expect(isHttpUrl(url), url).toBe(false);
      const res = await patch(b.id, { links: [link("x", "custom", url)] });
      expect(res.status, url).toBe(400);
    }
    expect(isHttpUrl("https://g.page/r/abc/review")).toBe(true);
    const eleven = Array.from({ length: MAX_BOOSTER_LINKS + 1 }, (_, i) => link(`l${i}`, "custom"));
    expect(boosterLinksSchema.safeParse(eleven).success).toBe(false);
    expect((await patch(b.id, { links: eleven })).status).toBe(400);
    expect((await patch(b.id, { links: eleven.slice(0, MAX_BOOSTER_LINKS) })).status).toBe(200);
  });

  it("BOOST-01 a form link opens one of the project's own forms, at its current address", async () => {
    const form = createForm(projectId, { name: "Stories", slug: "stories" });
    const other = createProject({ name: "Other", slug: "other" });
    const foreign = createForm(other.id, { name: "Theirs", slug: "theirs" });
    const b = createBooster(getProjectById(projectId)!, { name: "Reviews" });
    expect((await patch(b.id, { links: [{ id: "f", platform: "form", label: "", url: "", formId: foreign.id }] })).status).toBe(400);
    updateBooster(b.id, { links: [{ id: "f", platform: "form", label: "", url: "https://ignored.example", formId: form.id }], published: true });
    const res = await go("acme", "reviews", "f");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/f\/acme\/stories$/);
  });

  it("BOOST-01 the public page is under 50 KB with 10 long links, and loads nothing: no scripts, fonts or third-party files", async () => {
    const long = "x".repeat(60);
    publicBooster(
      Array.from({ length: 10 }, (_, i) => ({ ...link(`l${i}`, i % 2 ? "google" : "yelp", `https://reviews.example/${"p".repeat(1500)}${i}`), label: long })),
      { title: "T".repeat(120), message: "M".repeat(600) },
    );
    const res = await page("/b/acme/reviews");
    const html = await res.text();
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(Buffer.byteLength(html)).toBeLessThan(50 * 1024);
    expect(html).not.toMatch(/<script|<link[^>]+stylesheet|@import|url\(|<iframe/i);
    // The only addresses in the page are its own: link targets stay behind the click counter.
    expect(html).not.toContain("reviews.example");
    expect([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).every((u) => u.startsWith("/") || u.startsWith("http://localhost"))).toBe(true);
  });

  it("BOOST-01 old booster and project links answer 308 with the query kept, so printed QR codes keep working", async () => {
    const b = publicBooster([link("g", "google")]);
    changeBoosterSlug(b.id, "review-us");
    const moved = await page("/b/acme/reviews?src=qr");
    expect(moved.status).toBe(308);
    expect(moved.headers.get("location")).toMatch(/\/b\/acme\/review-us\?src=qr$/);
    changeProjectSlug(projectId, "acme-bakery");
    const both = await page("/b/acme/reviews");
    expect(both.status).toBe(308);
    expect(both.headers.get("location")).toMatch(/\/b\/acme-bakery\/review-us$/);
    expect((await page("/b/acme-bakery/review-us")).status).toBe(200);
  });

  it("BOOST-01 the logo is public only while the page is", () => {
    const b = createBooster(getProjectById(projectId)!, { name: "Reviews" });
    getDb().update(schema.boosters).set({ logoKey: "images/11111111-1111-4111-8111-111111111111.png" }).run();
    expect(isMediaPublic("images/11111111-1111-4111-8111-111111111111.png")).toBe(false);
    updateBooster(b.id, { published: true });
    expect(isMediaPublic("images/11111111-1111-4111-8111-111111111111.png")).toBe(true);
  });
});

describe("Google review link helper (BOOST-02)", () => {
  it("BOOST-02 a Place ID or a Maps link that carries one becomes a writereview link", () => {
    const id = "ChIJN1t_tDeuEmsRUsoyG83frY4";
    const want = `https://search.google.com/local/writereview?placeid=${id}`;
    for (const input of [
      id,
      ` ${id} `,
      `https://www.google.com/maps/search/?api=1&query=Acme&query_place_id=${id}`,
      `https://www.google.com/maps/place/?q=place_id:${id}`,
      `https://www.google.co.uk/maps/place/Acme+Bakery/@51.5,-0.1,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d51.5!4d-0.1!16s%2Fg%2F11!19s${id}?entry=ttu`,
      `https://search.google.com/local/writereview?placeid=${id}`,
    ]) {
      expect(googleReviewLink(input), input).toEqual({ ok: true, url: want, placeId: id });
    }
    expect(googleReviewLink("https://g.page/r/CabcDEF123/review")).toEqual({ ok: true, url: "https://g.page/r/CabcDEF123/review", placeId: null });
  });

  it("BOOST-02 short links, other sites and Maps links without a Place ID explain what to paste instead", () => {
    expect(googleReviewLink("https://maps.app.goo.gl/AbCd")).toMatchObject({ ok: false, error: expect.stringMatching(/Short links/) });
    expect(googleReviewLink("https://evil.example/maps?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4")).toMatchObject({ ok: false, error: expect.stringMatching(/isn't a Google Maps link/) });
    expect(googleReviewLink("https://www.google.com/maps/place/Acme+Bakery/@51.5,-0.1,17z")).toMatchObject({ ok: false, error: expect.stringMatching(/Place ID/) });
    expect(googleReviewLink("")).toMatchObject({ ok: false });
  });

  it("BOOST-02 business search calls the Places API from the server with the key, and is paste-only without one", async () => {
    const without = await placesRoute(new Request("http://localhost", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ query: "Acme Bakery" }) }));
    expect(without.status).toBe(409);
    expect((await without.json()).error).toMatch(/GOOGLE_PLACES_API_KEY/);

    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    const seen: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return Response.json({ places: [{ id: "ChIJN1t_tDeuEmsRUsoyG83frY4", displayName: { text: "Acme Bakery" }, formattedAddress: "1 High St, Leeds" }, { id: "<script>" }] });
    }) as unknown as typeof fetch;
    expect(await searchPlaces("Acme Bakery, Leeds", { fetchImpl: fake })).toEqual([{ placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4", name: "Acme Bakery", address: "1 High St, Leeds" }]);
    expect(seen[0].url).toBe("https://places.googleapis.com/v1/places:searchText");
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(headers["X-Goog-FieldMask"]).toBe("places.id,places.displayName,places.formattedAddress");
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ textQuery: "Acme Bakery, Leeds", pageSize: 5 });

    vi.spyOn(globalThis, "fetch").mockImplementation(fake);
    const res = await placesRoute(new Request("http://localhost", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ query: "Acme" }) }));
    expect((await res.json()).places[0].reviewUrl).toBe("https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4");
  });
});

describe("no gating (BOOST-03)", () => {
  it("BOOST-03 every visitor sees every link, whatever the link says (no rating step, nothing hidden)", async () => {
    const links = [link("a", "google"), link("b", "trustpilot"), link("c", "yelp"), link("d", "facebook"), link("e", "g2"), link("f", "capterra"), link("g", "tripadvisor"), link("h", "appstore"), link("i", "googleplay")];
    publicBooster(links);
    const shown = (html: string) => [...html.matchAll(/data-link="([a-z0-9]+)"/g)].map((m) => m[1]);
    for (const q of ["", "?rating=1", "?stars=5", "?rating=1&gate=1", "?r=whatever"]) {
      const html = await (await page(`/b/acme/reviews${q}`, `198.51.100.${q.length}`)).text();
      expect(shown(html), q).toEqual(links.map((l) => l.id));
      expect(html).not.toMatch(/\bstars?\b|rating|<form|<input/i);
    }
    // There is nothing to gate with: unknown settings are dropped before saving.
    const parsed = boosterPatchBody.parse({ minRating: 4, gate: true, showIf: "happy", links });
    expect(Object.keys(parsed)).toEqual(["links"]);
  });

  it("BOOST-03 the page and its links never carry or mention a reward, even when the project's form gives one", async () => {
    const form = createForm(projectId, { name: "Stories", slug: "stories" });
    updateForm(form.id, { reward: { mode: "same", kind: "code", code: "THANKS10", message: "10% off" } });
    publicBooster([{ id: "f", platform: "form", label: "", url: "", formId: form.id }, link("g", "google", "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4")]);
    const html = await (await page("/b/acme/reviews")).text();
    expect(html).not.toMatch(/THANKS10|10% off|reward|coupon|discount/i);
    const res = await go("acme", "reviews", "g");
    expect(res.headers.get("location")).toBe("https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4");
  });
});

describe("QR codes (BOOST-04)", () => {
  it("BOOST-04 a logo in the centre switches to error correction H and covers about 5% of the modules", () => {
    const url = "http://localhost:3000/b/acme/reviews";
    const plain = qrMatrix(url, "M");
    const strong = qrMatrix(url, "H");
    expect(strong.length).toBeGreaterThan(plain.length);
    const box = logoBox(strong.length);
    expect(box.size % 2).toBe(strong.length % 2);
    expect(box.start * 2 + box.size).toBe(strong.length);
    expect((box.size * box.size) / strong.length ** 2).toBeLessThan(0.06);
    // The finder patterns in three corners stay clear of the logo.
    expect(box.start).toBeGreaterThan(8);

    const svg = qrSvg(url, "#9a3412", { size: "60mm", logo: "data:image/png;base64,iVBORw0KGgo=" });
    expect(svg).toMatch(/^<svg[^>]+viewBox="0 0 \d+ \d+"[^>]+width="60mm" height="60mm"/);
    expect(svg).toContain('fill="#9a3412"');
    expect(svg).toContain('<image href="data:image/png;base64,iVBORw0KGgo="');
    // The modules under the logo are left out.
    const cx = box.start + 4 + Math.floor(box.size / 2);
    expect(svg).not.toContain(`M${cx} ${cx}h1v1h-1z`);
  });

  it("BOOST-04 print sizes are 300 dpi, and the plain code keeps the share panel's shape", () => {
    expect(QR_SIZES.find((s) => s.id === "6cm")).toMatchObject({ px: 709, mm: 60 });
    const svg = qrSvg("https://example.com/f/acme/stories", "#161b2e", 1024);
    expect(svg).toMatch(/^<svg[^>]+viewBox/);
    expect(svg).toContain('width="1024"');
    expect(svg).not.toContain("<image");
  });
});

describe("click analytics (BOOST-05)", () => {
  it("BOOST-05 a click is counted per link and day, then redirects to the stored link only", async () => {
    const b = publicBooster([link("g", "google", "https://search.google.com/local/writereview?placeid=X"), link("t", "trustpilot")]);
    for (let i = 0; i < 3; i++) {
      const res = await go("acme", "reviews", "g", "?url=https://evil.example&next=//evil.example");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://search.google.com/local/writereview?placeid=X");
    }
    await go("acme", "reviews", "t");
    // An unknown link is a 404, never a redirect.
    const unknown = await go("acme", "reviews", "nope", "?url=https://evil.example");
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("location")).toBeNull();

    const rows = getDb().select().from(schema.boosterClicks).all();
    expect(rows.map((r) => [r.linkId, r.count]).sort()).toEqual([["g", 3], ["t", 1]]);
    // Counts only: the table has no room for an address, a device or a cookie.
    expect(Object.keys(rows[0]).sort()).toEqual(["boosterId", "count", "day", "linkId"]);

    const res = await clicksRoute(new Request(`http://localhost/api/admin/boosters/${b.id}/clicks?days=7`, { headers: adminHeaders() }), params({ id: b.id }));
    const { stats } = await res.json();
    expect(stats.days).toHaveLength(7);
    expect(stats.total).toBe(4);
    expect(stats.links.map((l: { id: string; total: number; daily: number[] }) => [l.id, l.total, l.daily.at(-1)])).toEqual([["g", 3, 3], ["t", 1, 1]]);
  });

  it("BOOST-05 daily counts fall into their own days, and removed links still add up", () => {
    const b = publicBooster([link("g", "google")]);
    const day = (d: string) => new Date(`${d}T12:00:00Z`);
    const db = getDb();
    db.insert(schema.boosterClicks).values([
      { boosterId: b.id, linkId: "g", day: "2026-10-25", count: 2 },
      { boosterId: b.id, linkId: "g", day: "2026-10-27", count: 5 },
      { boosterId: b.id, linkId: "old", day: "2026-10-26", count: 1 },
    ]).run();
    const stats = clickStats(getBooster(b.id)!, 7, day("2026-10-27"));
    expect(stats.days.slice(-3)).toEqual(["2026-10-25", "2026-10-26", "2026-10-27"]);
    expect(stats.links[0].daily.slice(-3)).toEqual([2, 0, 5]);
    expect(stats.links[1]).toMatchObject({ id: "removed", total: 1 });
    expect(stats.total).toBe(8);
  });

  it("BOOST-05 the click counter is rate-limited per visitor, and drafts count nothing", async () => {
    const b = publicBooster([link("g", "google")]);
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await go("acme", "reviews", "g", "", "192.0.2.50")).status;
    expect(last).toBe(429);
    expect((await go("acme", "reviews", "g", "", "192.0.2.51")).status).toBe(302);
    expect(getDb().select().from(schema.boosterClicks).get()?.count).toBe(61);
    updateBooster(b.id, { published: false });
    expect((await go("acme", "reviews", "g", "", "192.0.2.52")).status).toBe(404);
  });
});
