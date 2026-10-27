import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE as deleteLogoRoute, POST as logoRoute } from "@/app/api/admin/projects/[id]/logo/route";
import { GET as redirectsRoute } from "@/app/api/admin/projects/[id]/redirects/route";
import { DELETE as deleteProjectRoute, PATCH as patchProjectRoute } from "@/app/api/admin/projects/[id]/route";
import { GET as slugCheckRoute, POST as slugRoute } from "@/app/api/admin/projects/[id]/slug/route";
import { DELETE as tagsDeleteRoute, GET as tagsRoute, PATCH as tagsPatchRoute } from "@/app/api/admin/projects/[id]/tags/route";
import { POST as createProjectRoute } from "@/app/api/admin/projects/route";
import { DELETE as deleteRedirectRoute } from "@/app/api/admin/redirects/[id]/route";
import { GET as media } from "@/app/api/media/[...key]/route";
import { POST as submit } from "@/app/api/projects/[slug]/testimonials/route";
import { POST as startUpload } from "@/app/api/projects/[slug]/uploads/route";
import { GET as widget } from "@/app/api/widget/[slug]/route";
import CollectPage from "@/app/c/[slug]/page";
import EmbedPage from "@/app/embed/[slug]/page";
import WallPage from "@/app/wall/[slug]/page";
import { getDb, schema } from "@/db";
import type { Project } from "@/db/schema";
import { createSessionToken, sessionCookieName } from "@/lib/auth";
import { grantConsent } from "@/lib/consent";
import { getDefaultForm } from "@/lib/forms";
import { listHistory } from "@/lib/history";
import { createImportTarget, exportZip, readManifest } from "@/lib/portability";
import { findProjectBySlugOrAlias, listRedirects, parseBrand, projectMediaKeys } from "@/lib/projects";
import { createRequests, requestToken } from "@/lib/requests";
import { resetStorage, saveUpload, storage } from "@/lib/storage";
import { createProject, createTestimonial, getProjectById, getTestimonial, updateTestimonial } from "@/lib/testimonials";
import { createUpload, uploadFilePath } from "@/lib/uploads";
import { createFakeS3, type FakeS3 } from "./fixtures/fake-s3";
import { adminHeaders, params, PNG_BYTES, submissionForm, submitRequest, useTempDataDir, WEBM_BYTES } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let acme: Project;

beforeEach(() => {
  ctx = useTempDataDir();
  acme = createProject({ name: "Acme", slug: "acme" });
});
afterEach(() => {
  delete process.env.ADMIN_EMAILS;
  ctx.cleanup();
});

type Init = { method?: string; json?: unknown; body?: BodyInit; headers?: Record<string, string> };

/** A request from the signed-in owner's dashboard (same-site, so it passes the CSRF check). */
function adminRequest(path: string, { method = "GET", json, body, headers = {} }: Init = {}) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { host: "localhost", ...(json !== undefined ? { "content-type": "application/json" } : {}), ...adminHeaders(), ...headers },
    body: json !== undefined ? JSON.stringify(json) : body,
  });
}

const changeSlug = (id: string, slug: string) =>
  slugRoute(adminRequest(`/api/admin/projects/${id}/slug`, { method: "POST", json: { slug } }), params({ id }));

const page = <T,>(slug: string, query: Record<string, string> = {}) =>
  ({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(query) }) as T;

/** What a page threw: a redirect's URL and status, a 404, or null when it rendered. */
async function outcome(render: Promise<unknown>) {
  try {
    await render;
    return null;
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? "";
    const redirect = /^NEXT_REDIRECT;[^;]*;(.*);(\d{3});$/.exec(digest);
    if (redirect) return { redirect: redirect[1], status: Number(redirect[2]) };
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return { status: 404 };
    throw err;
  }
}

const collect = (slug: string, query?: Record<string, string>) => CollectPage(page(slug, query));
const wall = (slug: string, query?: Record<string, string>) => WallPage(page(slug, query));
const embed = (slug: string, query?: Record<string, string>) => EmbedPage(page(slug, query));
const feed = (slug: string) => widget(new Request(`http://localhost/api/widget/${slug}`), params({ slug }));

function approved(projectId: string, name: string, text = "It works") {
  const t = createTestimonial(projectId, { name, text, rating: 5 });
  updateTestimonial(t.id, { status: "approved" });
  return t;
}

// ------------------------------------------------------------ slugs and old links

describe("TEAM-04 changing the link keeps old links working", () => {
  it("after a slug change, /c/<old>?r= answers 308 with the query and /api/widget/<old> answers 200 directly", async () => {
    approved(acme.id, "Grace");
    const { created } = createRequests(acme, [{ name: "Rae Requested", email: "rae@example.com", company: "Raeco" }], { send: false });
    const token = requestToken(created[0].id);
    const before = await feed("acme");
    const beforeBody = await before.json();

    const res = await changeSlug(acme.id, "acme-co");
    expect(res.status).toBe(200);
    expect((await res.json()).project).toMatchObject({ id: acme.id, slug: "acme-co" });

    // The collection page: a permanent redirect that keeps ?r= (and the rest), then the prefill still works.
    expect(await outcome(collect("acme", { r: token, utm_source: "mail" }))).toEqual({
      redirect: `/c/acme-co?r=${token}&utm_source=mail`,
      status: 308,
    });
    const html = renderToStaticMarkup((await collect("acme-co", { r: token })) as ReactElement);
    expect(html).toContain('value="Rae Requested"');
    expect(html).toContain('value="rae@example.com"');

    // The widget feed answers the old slug itself (no redirect), with the same items and headers.
    const after = await feed("acme");
    expect(after.status).toBe(200);
    expect(after.headers.get("access-control-allow-origin")).toBe("*");
    expect(after.headers.get("cache-control")).toBe(before.headers.get("cache-control"));
    const afterBody = await after.json();
    expect(afterBody.testimonials).toEqual(beforeBody.testimonials);
    expect(afterBody.project).toEqual({ ...beforeBody.project, slug: "acme-co" });
  });

  it("redirects the wall and the iframe embed too, and the embed keeps posting the slug its code listens for", async () => {
    approved(acme.id, "Grace");
    await changeSlug(acme.id, "acme-co");
    expect(await outcome(wall("acme", { theme: "dark", tag: "home" }))).toEqual({ redirect: "/wall/acme-co?theme=dark&tag=home", status: 308 });
    expect(await outcome(embed("acme", { theme: "dark" }))).toEqual({ redirect: "/embed/acme-co?theme=dark&as=acme", status: 308 });

    const frame = async (query: Record<string, string>) => renderToStaticMarkup((await embed("acme-co", query)) as ReactElement);
    expect(await frame({ as: "acme" })).toContain('data-slug="acme"');
    expect(await frame({})).toContain('data-slug="acme-co"');
    // ?as= counts only while it's one of this project's old slugs.
    createProject({ name: "Other", slug: "other" });
    expect(await frame({ as: "other" })).toContain('data-slug="acme-co"');
    expect(await frame({ as: "nope" })).toContain('data-slug="acme-co"');

    // The new links render as they are.
    expect(await outcome(collect("acme-co"))).toBeNull();
    expect(await outcome(wall("acme-co"))).toBeNull();
  });

  it("an open collection page on the old link can still upload and submit", async () => {
    await changeSlug(acme.id, "acme-co");
    const started = await startUpload(
      new Request("http://localhost/api/projects/acme/uploads", { method: "POST", body: JSON.stringify({ size: 1000 }), headers: { "x-forwarded-for": "203.0.113.9" } }),
      params({ slug: "acme" }),
    );
    expect(started.status).toBe(201);
    const res = await submit(submitRequest("acme", submissionForm({ name: "Late Lou", text: "Sent from the old page", consent: "on" })), params({ slug: "acme" }));
    expect(res.status).toBe(201);
    expect(getTestimonial((await res.json()).id)!.projectId).toBe(acme.id);
  });

  it("follows a chain of renames to the current link", async () => {
    await changeSlug(acme.id, "acme-co");
    await changeSlug(acme.id, "acme-inc");
    expect(await outcome(collect("acme"))).toEqual({ redirect: "/c/acme-inc", status: 308 });
    expect(await outcome(collect("acme-co"))).toEqual({ redirect: "/c/acme-inc", status: 308 });
    expect(listRedirects(acme.id).map((r) => r.oldPath).sort()).toEqual(["/c/acme", "/c/acme-co"]);

    const listed = await (await redirectsRoute(adminRequest(`/api/admin/projects/${acme.id}/redirects`), params({ id: acme.id }))).json();
    expect(listed.redirects.map((r: { oldSlug: string; target: string }) => [r.oldSlug, r.target]).sort()).toEqual([
      ["acme", "Acme"],
      ["acme-co", "Acme"],
    ]);
  });

  it("a new live slug wins over an alias: the alias is dropped and the response warns", async () => {
    approved(acme.id, "Grace");
    await changeSlug(acme.id, "acme-co");

    const res = await createProjectRoute(adminRequest("/api/admin/projects", { method: "POST", json: { name: "New Acme", slug: "acme" } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.warning).toBe("“acme” was an old link of Acme. Those links now open New Acme.");
    expect(findProjectBySlugOrAlias("acme")).toMatchObject({ project: { id: body.project.id }, canonical: true });
    expect(listRedirects(acme.id)).toEqual([]);
    // The new project answers at the slug now, with no redirect.
    expect(await outcome(collect("acme"))).toBeNull();
    expect((await (await feed("acme")).json()).project.name).toBe("New Acme");
    expect((await (await feed("acme")).json()).testimonials).toEqual([]);

    // A live slug is never taken over.
    const taken = await createProjectRoute(adminRequest("/api/admin/projects", { method: "POST", json: { name: "Again", slug: "acme-co" } }));
    expect(taken.status).toBe(409);
    expect((await taken.json()).error).toBe("That slug is already taken");
  });

  it("changing to another project's old slug takes it over, after the check says whose it was", async () => {
    await changeSlug(acme.id, "acme-co");
    const beta = createProject({ name: "Beta", slug: "beta" });
    const check = await (await slugCheckRoute(adminRequest(`/api/admin/projects/${beta.id}/slug?slug=acme`), params({ id: beta.id }))).json();
    expect(check).toEqual({ slug: "acme", available: true, replacesAliasOf: { id: acme.id, name: "Acme" } });

    const res = await changeSlug(beta.id, "acme");
    expect(res.status).toBe(200);
    expect((await res.json()).warning).toBe("“acme” was an old link of Acme. Those links now open this project.");
    expect(findProjectBySlugOrAlias("acme")!.project.id).toBe(beta.id);
    expect(findProjectBySlugOrAlias("beta")).toMatchObject({ project: { id: beta.id }, canonical: false });
    expect(listRedirects(acme.id)).toEqual([]);
  });

  it("refuses a slug a live project holds, and bad slugs", async () => {
    createProject({ name: "Beta", slug: "beta" });
    const taken = await changeSlug(acme.id, "beta");
    expect(taken.status).toBe(409);
    expect((await taken.json()).error).toBe("Another project already uses “beta”. Pick a different link.");
    expect((await changeSlug(acme.id, "Not OK!")).status).toBe(400);
    expect((await changeSlug("missing", "fine-slug")).status).toBe(404);
    expect(getProjectById(acme.id)!.slug).toBe("acme");
    expect(listRedirects(acme.id)).toEqual([]);

    const check = await (await slugCheckRoute(adminRequest(`/api/admin/projects/${acme.id}/slug?slug=beta`), params({ id: acme.id }))).json();
    expect(check).toMatchObject({ available: false, error: "Another project already uses “beta”. Pick a different link." });
    const own = await (await slugCheckRoute(adminRequest(`/api/admin/projects/${acme.id}/slug?slug=acme`), params({ id: acme.id }))).json();
    expect(own).toEqual({ slug: "acme", available: true });
  });

  it("a project that takes an old slug some other way (an archive import) still wins, and the old link isn't listed", async () => {
    await changeSlug(acme.id, "acme-co");
    const imported = createProject({ name: "Imported", slug: "acme" });
    expect(findProjectBySlugOrAlias("acme")).toMatchObject({ project: { id: imported.id }, canonical: true });
    expect(await outcome(collect("acme"))).toBeNull();
    expect(listRedirects(acme.id)).toEqual([]);
  });

  it("an archive import doesn't take another project's old link: it gets the next free slug", async () => {
    await changeSlug(acme.id, "acme-co");
    const file = path.join(ctx.dir, "acme.zip");
    fs.writeFileSync(file, Buffer.from(await new Response(exportZip(getProjectById(acme.id)!)).arrayBuffer()));
    const { manifest } = await readManifest(file);
    const copy = createImportTarget(manifest, { slug: "acme" });
    expect(copy.slug).toBe("acme-2");
    expect(findProjectBySlugOrAlias("acme")).toMatchObject({ project: { id: acme.id }, canonical: false });
    expect(listRedirects(acme.id).map((r) => r.oldSlug)).toEqual(["acme"]);
  });

  it("renaming back to an old slug makes it live again", async () => {
    await changeSlug(acme.id, "acme-co");
    await changeSlug(acme.id, "acme");
    expect(listRedirects(acme.id).map((r) => r.oldSlug)).toEqual(["acme-co"]);
    expect(await outcome(collect("acme"))).toBeNull();
    expect(await outcome(collect("acme-co"))).toEqual({ redirect: "/c/acme", status: 308 });
  });

  it("removing an old link makes it 404", async () => {
    await changeSlug(acme.id, "acme-co");
    const [alias] = listRedirects(acme.id);
    const res = await deleteRedirectRoute(adminRequest(`/api/admin/redirects/${alias.id}`, { method: "DELETE" }), params({ id: alias.id }));
    expect(res.status).toBe(200);
    expect(await outcome(collect("acme"))).toEqual({ status: 404 });
    expect((await feed("acme")).status).toBe(404);
    expect((await deleteRedirectRoute(adminRequest(`/api/admin/redirects/${alias.id}`, { method: "DELETE" }), params({ id: alias.id }))).status).toBe(404);
  });
});

// ------------------------------------------------------------------ delete

const KEYS = { accessKeyId: "PLAUDITTESTKEY", secretAccessKey: "plaudit-test-secret-0123456789" };
const S3_ENV = {
  STORAGE_DRIVER: "s3",
  S3_ENDPOINT: "http://minio.test:9000",
  S3_REGION: "eu-west-2",
  S3_BUCKET: "plaudit-media",
  S3_ACCESS_KEY_ID: KEYS.accessKeyId,
  S3_SECRET_ACCESS_KEY: KEYS.secretAccessKey,
  S3_FORCE_PATH_STYLE: "true",
};

const deleteRequest = (id: string, json: unknown, headers: Record<string, string> = {}) =>
  deleteProjectRoute(adminRequest(`/api/admin/projects/${id}`, { method: "DELETE", json, headers }), params({ id }));

const image = async () => (await saveUpload(new File([PNG_BYTES], "a.png", { type: "image/png" }), "image")).key;
const video = async () => (await saveUpload(new File([WEBM_BYTES], "a.webm", { type: "video/webm" }), "video")).key;

/** Rows that point at the project, in every table that has a project_id (child rows are counted through their parents). */
function rowsOf(projectId: string) {
  const db = getDb();
  const n = (q: ReturnType<typeof sql>) => db.get<{ n: number }>(q)!.n;
  return {
    projects: n(sql`SELECT count(*) AS n FROM projects WHERE id = ${projectId}`),
    ...Object.fromEntries(
      ["testimonials", "tags", "consent_versions", "requests", "webhooks", "uploads", "forms", "customers", "feedback", "slug_redirects", "widgets", "walls", "seo_snippets", "task_runs", "notification_channels", "testimonial_search"].map((t) => [
        t,
        n(sql.raw(`SELECT count(*) AS n FROM ${t} WHERE project_id = '${projectId}'`)),
      ]),
    ),
  };
}

describe("TEAM-04 deleting a project", () => {
  it("needs the project's name typed exactly", async () => {
    for (const body of [{}, { confirm: "" }, { confirm: "acme" }, { confirm: "Acm" }, null]) {
      const res = await deleteRequest(acme.id, body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Type the project's name exactly as it's shown to delete it.");
    }
    expect(getProjectById(acme.id)).not.toBeNull();
    expect((await deleteRequest("missing", { confirm: "Acme" })).status).toBe(404);
  });

  it("is for the owner only, and refuses cross-site requests and visitors", async () => {
    process.env.ADMIN_EMAILS = "ada@example.com";
    const ada = { cookie: `${sessionCookieName()}=${createSessionToken("ada@example.com")}` };
    const admin = await deleteRequest(acme.id, { confirm: "Acme" }, ada);
    expect(admin.status).toBe(403);
    expect((await admin.json()).error).toBe("Only the owner can do this");

    const csrf = await deleteRequest(acme.id, { confirm: "Acme" }, { origin: "https://evil.example" });
    expect(csrf.status).toBe(403);

    const visitor = await deleteProjectRoute(
      new Request(`http://localhost/api/admin/projects/${acme.id}`, { method: "DELETE", body: JSON.stringify({ confirm: "Acme" }), headers: { "sec-fetch-site": "same-origin" } }),
      params({ id: acme.id }),
    );
    expect(visitor.status).toBe(401);
    expect(getProjectById(acme.id)).not.toBeNull();
  });

  it("CSRF gives 403 on every settings change", async () => {
    const evil = { origin: "https://evil.example" };
    const id = acme.id;
    const results = await Promise.all([
      slugRoute(adminRequest(`/api/admin/projects/${id}/slug`, { method: "POST", json: { slug: "x-y" }, headers: evil }), params({ id })),
      patchProjectRoute(adminRequest(`/api/admin/projects/${id}`, { method: "PATCH", json: { name: "X" }, headers: evil }), params({ id })),
      tagsPatchRoute(adminRequest(`/api/admin/projects/${id}/tags`, { method: "PATCH", json: { action: "rename", from: "a", to: "b" }, headers: evil }), params({ id })),
      tagsDeleteRoute(adminRequest(`/api/admin/projects/${id}/tags`, { method: "DELETE", json: { name: "a" }, headers: evil }), params({ id })),
      deleteLogoRoute(adminRequest(`/api/admin/projects/${id}/logo`, { method: "DELETE", headers: evil }), params({ id })),
      deleteRedirectRoute(adminRequest(`/api/admin/redirects/x`, { method: "DELETE", headers: evil }), params({ id: "x" })),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403]);
    expect(getProjectById(id)!.slug).toBe("acme");
  });

  describe.each(["local", "s3"] as const)("on %s storage", (driver) => {
    let fake: FakeS3 | null = null;
    beforeEach(() => {
      if (driver === "s3") {
        fake = createFakeS3({ bucket: S3_ENV.S3_BUCKET, region: S3_ENV.S3_REGION, ...KEYS });
        Object.assign(process.env, S3_ENV);
        resetStorage({ fetch: fake.fetch });
      }
    });
    afterEach(() => {
      for (const k of Object.keys(S3_ENV)) delete process.env[k];
      resetStorage();
      fake = null;
    });

    it("removes its rows and files, and leaves other projects alone", async () => {
      expect(storage().name).toBe(driver);
      const db = getDb();
      const id = acme.id;

      // Files of every kind the project can own.
      const t = createTestimonial(id, { name: "Grace", text: "Brilliant", avatarKey: await image(), videoKey: await video(), videoMime: "video/webm" });
      db.update(schema.testimonials).set({ posterKey: await image(), companyLogoKey: await image() }).where(eq(schema.testimonials.id, t.id)).run();
      updateTestimonial(t.id, { status: "approved", tags: ["home"] });
      grantConsent({ testimonialId: t.id, project: acme, scopes: ["website"], actor: "customer" });
      db.insert(schema.answers).values({ id: crypto.randomUUID(), testimonialId: t.id, questionKey: "q2", questionTitle: "And?", position: 1, videoKey: await video(), posterKey: await image() }).run();
      db.insert(schema.testimonialImages).values({ id: crypto.randomUUID(), testimonialId: t.id, key: await image() }).run();
      db.update(schema.forms).set({ logoKey: await image() }).where(eq(schema.forms.id, getDefaultForm(id).id)).run();
      db.insert(schema.walls).values({ id: crypto.randomUUID(), projectId: id, slug: "love", name: "Love", logoKey: await image(), coverKey: await image() }).run();
      db.update(schema.projects).set({ logoKey: await image() }).where(eq(schema.projects.id, id)).run();
      db.insert(schema.customers).values({ id: crypto.randomUUID(), projectId: id, email: "grace@example.com", name: "Grace", avatarKey: await image() }).run();
      // Rows without files: a request, a project webhook, an old link, an unfinished upload.
      createRequests(acme, [{ email: "rae@example.com" }], { send: false });
      db.insert(schema.webhooks).values({ id: crypto.randomUUID(), url: "https://hooks.example/x", secret: "s", projectId: id }).run();
      await changeSlug(id, "acme-co");
      const { upload } = createUpload("video", { projectId: id, maxBytes: 1000 });
      const partFile = uploadFilePath(upload);
      expect(fs.existsSync(partFile)).toBe(true);

      // Another project, with a file of its own.
      const other = createProject({ name: "Other", slug: "other" });
      const otherKey = await image();
      createTestimonial(other.id, { name: "Olu", text: "Fine", avatarKey: otherKey });
      const otherRows = rowsOf(other.id);

      const keys = projectMediaKeys(id);
      expect(keys).toHaveLength(12);
      for (const k of keys) expect(await storage().stat(k)).not.toBeNull();

      const res = await deleteRequest(id, { confirm: "Acme" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deleted: true, files: 12 });

      expect(Object.values(rowsOf(id)).every((n) => n === 0)).toBe(true);
      for (const table of ["answers", "testimonial_images", "testimonial_tags", "consent_events", "testimonial_history", "highlights"]) {
        expect(db.get<{ n: number }>(sql.raw(`SELECT count(*) AS n FROM ${table} WHERE testimonial_id = '${t.id}'`))!.n).toBe(0);
      }
      expect(db.get<{ n: number }>(sql`SELECT count(*) AS n FROM testimonials_fts WHERE testimonials_fts MATCH 'Brilliant'`)!.n).toBe(0);
      expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      for (const k of keys) expect(await storage().stat(k)).toBeNull();
      if (fake) expect([...fake.objects.keys()]).toEqual([otherKey]);
      expect(fs.existsSync(partFile)).toBe(false);
      expect(findProjectBySlugOrAlias("acme")).toBeNull();
      expect(findProjectBySlugOrAlias("acme-co")).toBeNull();

      expect(rowsOf(other.id)).toEqual(otherRows);
      expect(await storage().stat(otherKey)).not.toBeNull();
    });
  });
});

// ------------------------------------------------------------ brand kit and logo

describe("TEAM-04 brand kit and logo", () => {
  const patch = (json: unknown) => patchProjectRoute(adminRequest(`/api/admin/projects/${acme.id}`, { method: "PATCH", json }), params({ id: acme.id }));

  it("saves the brand kit, website and business type through PATCH", async () => {
    const brand = { colors: { primary: "#3d63dd", star: "#f5b301" }, fonts: { heading: "serif" } };
    const res = await patch({ brand, website: "https://acme.example", businessType: "saas" });
    expect(res.status).toBe(200);
    const { project } = await res.json();
    expect(project).toMatchObject({ website: "https://acme.example", businessType: "saas" });
    expect(parseBrand(getProjectById(acme.id)!.brand)).toEqual(brand);
    // The form fields aren't touched by it.
    expect(getProjectById(acme.id)!.accentColor).toBe(acme.accentColor);

    expect((await patch({ brand: { colors: { primary: "blue" } } })).status).toBe(400);
    expect((await patch({ website: "javascript:alert(1)" })).status).toBe(400);
    expect((await patch({ website: "", businessType: "" })).status).toBe(200);
    expect(getProjectById(acme.id)).toMatchObject({ website: null, businessType: null });
  });

  it("reads a broken brand column as empty", () => {
    expect(parseBrand("{not json")).toEqual({ colors: {}, fonts: {} });
    expect(parseBrand('{"colors":{"primary":"red"}}')).toEqual({ colors: {}, fonts: {} });
    expect(parseBrand(null)).toEqual({ colors: {}, fonts: {} });
  });

  it("uploads, replaces and removes the logo, which is public", async () => {
    const upload = (file: File) => {
      const body = new FormData();
      body.set("logo", file);
      return logoRoute(adminRequest(`/api/admin/projects/${acme.id}/logo`, { method: "POST", body }), params({ id: acme.id }));
    };
    const res = await upload(new File([PNG_BYTES], "logo.png", { type: "image/png" }));
    expect(res.status).toBe(200);
    const first = (await res.json()).project.logoKey as string;
    expect(first).toMatch(/^images\/[0-9a-f-]{36}\.png$/);
    const served = await media(new Request(`http://localhost/api/media/${first}`), params({ key: first.split("/") }));
    expect(served.status).toBe(200);

    const second = (await (await upload(new File([PNG_BYTES], "logo2.png", { type: "image/png" }))).json()).project.logoKey as string;
    expect(second).not.toBe(first);
    expect(await storage().stat(first)).toBeNull();

    const svg = await upload(new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], "logo.svg", { type: "image/svg+xml" }));
    expect(svg.status).toBe(415);
    expect((await logoRoute(adminRequest(`/api/admin/projects/${acme.id}/logo`, { method: "POST", body: new FormData() }), params({ id: acme.id }))).status).toBe(400);
    expect(getProjectById(acme.id)!.logoKey).toBe(second);

    const removed = await deleteLogoRoute(adminRequest(`/api/admin/projects/${acme.id}/logo`, { method: "DELETE" }), params({ id: acme.id }));
    expect((await removed.json()).project.logoKey).toBeNull();
    expect(await storage().stat(second)).toBeNull();
  });
});

// ---------------------------------------------------------------- tags

describe("TEAM-04 tags manager", () => {
  let a: string, b: string, c: string;
  beforeEach(() => {
    a = createTestimonial(acme.id, { name: "A", text: "one" }).id;
    b = createTestimonial(acme.id, { name: "B", text: "two" }).id;
    c = createTestimonial(acme.id, { name: "C", text: "three" }).id;
    updateTestimonial(a, { tags: ["pricing", "home"] });
    updateTestimonial(b, { tags: ["price"] });
    updateTestimonial(c, { tags: ["cost", "pricing"] });
  });

  const tagsOf = (id: string) => getTestimonial(id)!.tags;
  const change = async (json: unknown) => {
    const res = await tagsPatchRoute(adminRequest(`/api/admin/projects/${acme.id}/tags`, { method: "PATCH", json }), params({ id: acme.id }));
    return { status: res.status, body: await res.json() };
  };

  it("lists each tag with how many testimonials have it", async () => {
    const res = await tagsRoute(adminRequest(`/api/admin/projects/${acme.id}/tags`), params({ id: acme.id }));
    expect((await res.json()).tags).toEqual([
      { name: "cost", count: 1 },
      { name: "home", count: 1 },
      { name: "price", count: 1 },
      { name: "pricing", count: 2 },
    ]);
  });

  it("renames a tag everywhere, with a history entry naming who did it", async () => {
    const { status, body } = await change({ action: "rename", from: "pricing", to: " Plans " });
    expect(status).toBe(200);
    expect(body.tags.map((t: { name: string }) => t.name)).toEqual(["cost", "home", "plans", "price"]);
    expect(tagsOf(a)).toEqual(["home", "plans"]);
    expect(tagsOf(c)).toEqual(["cost", "plans"]);
    const last = listHistory(a).at(-1)!;
    expect(last).toMatchObject({ action: "tags", actor: "owner", actorEmail: "owner@example.com" });
    expect(JSON.parse(last.diff)).toEqual({ tags: [["home", "pricing"], ["home", "plans"]] });
    expect(listHistory(b).filter((h) => h.action === "tags")).toHaveLength(1);
  });

  it("won't rename onto an existing tag (that's a merge), or rename one that isn't there", async () => {
    expect(await change({ action: "rename", from: "price", to: "pricing" })).toEqual({
      status: 409,
      body: { error: "There's already a tag called “pricing”. Merge the two tags instead." },
    });
    expect((await change({ action: "rename", from: "nope", to: "x" })).status).toBe(404);
    expect((await change({ action: "rename", from: "price", to: "" })).status).toBe(400);
    expect(tagsOf(b)).toEqual(["price"]);
  });

  it("merges tags into one, keeping one tag per testimonial", async () => {
    const { status, body } = await change({ action: "merge", from: ["price", "cost", "pricing"], into: "pricing" });
    expect(status).toBe(200);
    expect(body.tags).toEqual([
      { name: "home", count: 1 },
      { name: "pricing", count: 3 },
    ]);
    expect(tagsOf(a)).toEqual(["home", "pricing"]);
    expect(tagsOf(b)).toEqual(["pricing"]);
    expect(tagsOf(c)).toEqual(["pricing"]);
    // a already had "pricing" and only that: nothing changed for it.
    expect(listHistory(a).filter((h) => h.action === "tags")).toHaveLength(1);
    expect(listHistory(c).filter((h) => h.action === "tags")).toHaveLength(2);

    // Into a brand-new name works too.
    await change({ action: "merge", from: ["home", "pricing"], into: "all" });
    expect(tagsOf(a)).toEqual(["all"]);
    expect((await change({ action: "merge", from: ["all"], into: "all" })).status).toBe(400);
    expect((await change({ action: "merge", from: ["ghost"], into: "all" })).status).toBe(404);
  });

  it("deletes a tag from every testimonial, keeping the testimonials", async () => {
    const res = await tagsDeleteRoute(adminRequest(`/api/admin/projects/${acme.id}/tags`, { method: "DELETE", json: { name: "pricing" } }), params({ id: acme.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).tags.map((t: { name: string }) => t.name)).toEqual(["cost", "home", "price"]);
    expect(tagsOf(a)).toEqual(["home"]);
    expect(tagsOf(c)).toEqual(["cost"]);
    expect(getTestimonial(c)).not.toBeNull();
    const again = await tagsDeleteRoute(adminRequest(`/api/admin/projects/${acme.id}/tags`, { method: "DELETE", json: { name: "pricing" } }), params({ id: acme.id }));
    expect(again.status).toBe(404);
  });

  it("keeps each project's tags to itself", async () => {
    const other = createProject({ name: "Other", slug: "other" });
    const o = createTestimonial(other.id, { name: "O", text: "x" }).id;
    updateTestimonial(o, { tags: ["pricing"] });
    await change({ action: "rename", from: "pricing", to: "plans" });
    expect(tagsOf(o)).toEqual(["pricing"]);
  });
});
