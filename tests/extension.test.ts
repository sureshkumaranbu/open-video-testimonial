import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createRoute } from "@/app/api/v1/projects/[slug]/testimonials/route";
import { getDb, schema } from "@/db";
import { createApiKey } from "@/lib/api-keys";
import { openZip } from "@/lib/zip";
import { createProject, getTestimonial } from "@/lib/testimonials";
import { proxy } from "@/proxy";
import { build, firefoxManifest } from "../scripts/build-extension.mjs";
// @ts-expect-error plain JS module, checked by these tests
import { serverOrigin, testimonialPayload } from "../extension/lib.js";
import { params, useTempDataDir } from "./helpers";

/** EXT-01 (M18): the browser extension's page parsers, its API payload, its packages, and /api/v1's CORS for it. */

const ROOT = path.resolve(__dirname, "..");
const CAPTURE = fs.readFileSync(path.join(ROOT, "extension/capture.js"), "utf8");

type Capture = { text: string; url: string | null; title: string | null; platform: string | null; sourceUrl: string | null; author: Record<string, string | null> };

/** Loads `html` at `url`, selects the text of `select` (a CSS selector) and runs the extension's capture.js there. */
function capture(html: string, url: string, select?: string): Capture {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  const { window } = dom;
  if (select) {
    const range = window.document.createRange();
    range.selectNodeContents(window.document.querySelector(select)!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  }
  window.eval(CAPTURE);
  return JSON.parse(JSON.stringify((window as unknown as { plauditCapture: (d: Document) => Capture }).plauditCapture(window.document)));
}

const X_POST = `<!doctype html><title>Ada on X</title><main>
<article data-testid="tweet">
  <div data-testid="Tweet-User-Avatar"><a href="/ada"><img src="https://pbs.twimg.com/profile_images/1/ada_normal.jpg" alt=""></a></div>
  <div data-testid="User-Name"><a href="/ada"><span><span>Ada Lovelace</span></span></a><a href="/ada"><span>@ada</span></a><span>·</span><a href="/ada/status/123"><time datetime="2026-10-01T10:00:00Z">Oct 1</time></a></div>
  <div data-testid="tweetText"><span>Plaudit made collecting video testimonials painless. </span><span id="sel">Ten a week now.</span></div>
</article>
<article data-testid="tweet"><div data-testid="User-Name"><span>Someone Else</span><span>@else</span></div><div data-testid="tweetText">Another post</div></article>
</main>`;

const LINKEDIN_POST = `<!doctype html><title>Feed | LinkedIn</title>
<div class="feed-shared-update-v2" data-urn="urn:li:activity:1">
  <div class="update-components-actor">
    <a class="update-components-actor__image" href="https://www.linkedin.com/in/grace-hopper?miniProfileUrn=abc"><img src="https://media.licdn.com/dms/image/grace.jpg" alt="Grace Hopper"></a>
    <a class="update-components-actor__meta-link" href="https://www.linkedin.com/in/grace-hopper?miniProfileUrn=abc">
      <span class="update-components-actor__title"><span aria-hidden="true">Grace Hopper</span><span class="visually-hidden">View Grace Hopper's profile</span></span>
      <span class="update-components-actor__description"><span aria-hidden="true">Rear Admiral at US Navy</span></span>
    </a>
  </div>
  <div class="update-components-text"><span id="sel">We switched to Plaudit and our wall of love finally looks the part.</span></div>
</div>`;

describe("EXT-01 page parsers", () => {
  it("EXT-01 an X post: the selection, the author's name, handle and photo, and the post's own link", () => {
    const c = capture(X_POST, "https://x.com/ada/status/123", "#sel");
    expect(c).toMatchObject({
      text: "Ten a week now.",
      platform: "x",
      title: "Ada on X",
      sourceUrl: "https://x.com/ada/status/123",
      author: { name: "Ada Lovelace", handle: "@ada", avatarUrl: "https://pbs.twimg.com/profile_images/1/ada_normal.jpg", profileUrl: "https://x.com/ada" },
    });
  });

  it("EXT-01 on X with nothing selected, the post's own words; twitter.com counts too", () => {
    const c = capture(X_POST, "https://twitter.com/ada/status/123");
    expect(c.text).toBe("Plaudit made collecting video testimonials painless. Ten a week now.");
    expect(c.author.name).toBe("Ada Lovelace");
  });

  it("EXT-01 a LinkedIn post: the author's name, profile (without tracking), headline and photo", () => {
    const c = capture(LINKEDIN_POST, "https://www.linkedin.com/feed/update/urn:li:activity:1/", "#sel");
    expect(c).toMatchObject({
      text: "We switched to Plaudit and our wall of love finally looks the part.",
      platform: "linkedin",
      author: { name: "Grace Hopper", handle: null, profileUrl: "https://www.linkedin.com/in/grace-hopper", headline: "Rear Admiral at US Navy", avatarUrl: "https://media.licdn.com/dms/image/grace.jpg" },
    });
  });

  it("EXT-01 when X's markup has changed, it falls back to the plain selection and the page's own author tag", () => {
    const changed = `<!doctype html><title>Post</title><meta name="author" content="Ada L"><article data-testid="tweet"><div class="nope"><span id="sel">Still great</span></div></article>`;
    const c = capture(changed, "https://x.com/ada/status/1", "#sel");
    expect(c).toMatchObject({ text: "Still great", platform: null, sourceUrl: "https://x.com/ada/status/1", author: { name: "Ada L", handle: null } });
  });

  it("EXT-01 any other page: the selection, its title and URL, and an author from its tags (never a URL as a name)", () => {
    const page = `<!doctype html><title>Our customers</title><meta property="article:author" content="https://example.com/team"><blockquote><p id="sel">  Best   tool we bought   this year. </p><footer><span itemprop="author">Sam Jones</span></footer></blockquote>`;
    const c = capture(page, "https://shop.example/reviews?page=2", "#sel");
    expect(c).toMatchObject({ text: "Best tool we bought this year.", title: "Our customers", url: "https://shop.example/reviews?page=2", platform: null, author: { name: null } });
    const tagged = capture(`<!doctype html><title>T</title><div itemprop="author"><span itemprop="name">Sam Jones</span></div><p id="sel">Hi</p>`, "https://a.example/", "#sel");
    expect(tagged.author.name).toBe("Sam Jones");
  });
});

describe("EXT-01 what the extension sends", () => {
  it("EXT-01 the create-testimonial body: Pending, the human's consent, the post's link and author profile, an https photo only", () => {
    const c = capture(X_POST, "https://x.com/ada/status/123", "#sel");
    expect(testimonialPayload(c, { text: " Ten a week now! ", name: "Ada" })).toEqual({
      name: "Ada",
      text: "Ten a week now!",
      status: "pending",
      consent: true,
      platform: "x",
      sourceUrl: "https://x.com/ada/status/123",
      socials: { x: "@ada" },
      avatarUrl: "https://pbs.twimg.com/profile_images/1/ada_normal.jpg",
      customFields: { page_title: "Ada on X" },
    });
    const generic = testimonialPayload({ text: "Hi", url: "javascript:alert(1)", title: null, platform: null, sourceUrl: null, author: { avatarUrl: "http://insecure.example/a.png" } }, { name: "Sam" });
    expect(generic).toEqual({ name: "Sam", text: "Hi", status: "pending", consent: true });
    expect(serverOrigin("https://plaudit.example.com/admin")).toBe("https://plaudit.example.com");
    expect(serverOrigin("http://plaudit.example.com")).toBeNull();
    expect(serverOrigin("http://127.0.0.1:3200")).toBe("http://127.0.0.1:3200");
  });

  it("EXT-01 the manifest asks for activeTab and the server's origin at runtime only; never <all_urls>", () => {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, "extension/manifest.json"), "utf8"));
    expect(m.manifest_version).toBe(3);
    expect(m.permissions).toEqual(["activeTab", "contextMenus", "scripting", "storage"]);
    expect(m.host_permissions).toBeUndefined();
    expect(m.content_scripts).toBeUndefined();
    expect(JSON.stringify(m)).not.toContain("<all_urls>");
    expect(m.optional_host_permissions).toEqual(["https://*/*", "http://*/*"]);
    const ff = firefoxManifest(m, "test@plaudit.invalid") as { background: unknown; browser_specific_settings: { gecko: { id: string } } };
    expect(ff.background).toEqual({ scripts: ["background.js"], type: "module" });
    expect(ff.browser_specific_settings.gecko.id).toBe("test@plaudit.invalid");
    // No framework, no remote code: every script is one of ours.
    for (const f of fs.readdirSync(path.join(ROOT, "extension")).filter((f) => f.endsWith(".js"))) {
      expect(fs.readFileSync(path.join(ROOT, "extension", f), "utf8")).not.toMatch(/https?:\/\/[^"'\s]*\.js\b|import\s.*from\s+["']https?:/);
    }
  });

  it("EXT-01 npm run build:extension writes a Chrome and a Firefox zip with every file", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "plaudit-ext-"));
    try {
      const r = build(out);
      for (const file of [r.chrome, r.firefox]) {
        const z = await openZip(file);
        expect([...z.entries.keys()]).toEqual(expect.arrayContaining(["manifest.json", "background.js", "capture.js", "lib.js", "popup.html", "options.html", "icons/icon-128.png"]));
      }
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("EXT-01 /api/v1 CORS for the extension", () => {
  const EXT = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
  const at = (method: string, headers: Record<string, string>) => proxy(new NextRequest("http://localhost/api/v1/projects", { method, headers }));

  it("EXT-01 answers the preflight for an extension origin that will send the key, and nobody else", () => {
    const ok = at("OPTIONS", { origin: EXT, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(EXT);
    expect(ok.headers.get("access-control-allow-headers")).toMatch(/Authorization/);
    expect(ok.headers.get("access-control-allow-credentials")).toBeNull();
    const firefox = at("OPTIONS", { origin: "moz-extension://0d6c8e3a-1b2c-4d5e-8f90-123456789abc", "access-control-request-headers": "authorization" });
    expect(firefox.headers.get("access-control-allow-origin")).toBe("moz-extension://0d6c8e3a-1b2c-4d5e-8f90-123456789abc");
    expect(at("OPTIONS", { origin: EXT, "access-control-request-headers": "content-type" }).headers.get("access-control-allow-origin")).toBeNull();
    expect(at("OPTIONS", { origin: "https://evil.example", "access-control-request-headers": "authorization" }).headers.get("access-control-allow-origin")).toBeNull();
    expect(at("OPTIONS", { origin: "chrome-extension://short", "access-control-request-headers": "authorization" }).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("EXT-01 a request is readable from the extension only when it carries an API key, never with cookies", () => {
    const withKey = at("GET", { origin: EXT, authorization: "Bearer plk_0123456789abcdefghijkl" });
    expect(withKey.headers.get("access-control-allow-origin")).toBe(EXT);
    expect(withKey.headers.get("access-control-allow-credentials")).toBeNull();
    expect(at("GET", { origin: EXT, cookie: "plaudit_session=x" }).headers.get("access-control-allow-origin")).toBeNull();
    expect(at("GET", { origin: "https://evil.example", authorization: "Bearer plk_0123456789abcdefghijkl" }).headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("EXT-01 the create endpoint", () => {
  let ctx: ReturnType<typeof useTempDataDir>;
  beforeEach(() => {
    ctx = useTempDataDir();
    createProject({ name: "Acme", slug: "acme" });
  });
  afterEach(() => ctx.cleanup());

  it("EXT-01 takes the author's profile and an https photo (fetched in the background) and lands as Pending", async () => {
    const { key } = createApiKey("Extension", "write");
    const post = (body: object) =>
      createRoute(new Request("http://localhost/api/v1/projects/acme/testimonials", { method: "POST", body: JSON.stringify(body), headers: { authorization: `Bearer ${key}`, "content-type": "application/json" } }), params({ slug: "acme" }));
    const body = { name: "Ada", text: "Ten a week now.", status: "pending", consent: true, platform: "x", sourceUrl: "https://x.com/ada/status/123", socials: { x: "@ada" }, avatarUrl: "https://pbs.twimg.com/a.jpg", customFields: { page_title: "Ada on X" } };
    const res = await post(body);
    expect(res.status, await res.clone().text()).toBe(201);
    const { data } = await res.json();
    const t = getTestimonial(data.id)!;
    expect(t).toMatchObject({ status: "pending", platform: "x", authorSocials: JSON.stringify({ x: "@ada" }), sourceUrl: "https://x.com/ada/status/123" });
    const jobs = getDb().select().from(schema.jobs).all().filter((j) => j.type === "import.media");
    expect(jobs.map((j) => JSON.parse(j.payload))).toEqual([{ testimonialId: data.id, videoUrl: null, avatarUrl: "https://pbs.twimg.com/a.jpg" }]);
    expect((await post({ ...body, avatarUrl: "http://pbs.twimg.com/a.jpg" })).status).toBe(400);
  });
});
