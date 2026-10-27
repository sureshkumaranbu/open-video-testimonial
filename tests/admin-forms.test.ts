import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as defaultRoute } from "@/app/api/admin/forms/[id]/default/route";
import { POST as duplicateRoute } from "@/app/api/admin/forms/[id]/duplicate/route";
import { DELETE as logoDelete, POST as logoRoute } from "@/app/api/admin/forms/[id]/logo/route";
import { DELETE as deleteRoute, GET as getRoute, PATCH as patchRoute } from "@/app/api/admin/forms/[id]/route";
import { POST as slugRoute } from "@/app/api/admin/forms/[id]/slug/route";
import { POST as upgradeRoute } from "@/app/api/admin/forms/[id]/upgrade/route";
import { GET as templatesRoute } from "@/app/api/admin/form-templates/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/admin/projects/[id]/forms/route";
import { getDefaultForm, getFormBySlug } from "@/lib/forms";
import { createProject, createTestimonial, getProjectById, getTestimonial } from "@/lib/testimonials";
import { adminCookie, adminHeaders, params, PNG_BYTES, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => ctx.cleanup());

const req = (url: string, init: RequestInit & { json?: unknown } = {}) =>
  new Request(`http://localhost${url}`, {
    ...init,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    headers: { ...adminHeaders(), ...(init.json !== undefined ? { "content-type": "application/json" } : {}), ...init.headers },
  });

async function create(body: object) {
  const res = await createRoute(req(`/api/admin/projects/${projectId}/forms`, { method: "POST", json: body }), params({ id: projectId }));
  return { status: res.status, body: await res.json() };
}

const id = (formId: string) => params({ id: formId });

describe("forms admin API", () => {
  it("FORM-01 lists, creates, edits and deletes forms; testimonials outlive their form", async () => {
    const made = await create({ name: "Customer stories", template: "saas" });
    expect(made.status).toBe(201);
    const form = made.body.form;
    expect(form).toMatchObject({ name: "Customer stories", slug: "customer-stories", layout: "steps", isDefault: false, template: "saas" });
    expect(form.links.hosted).toMatch(/\/f\/acme\/customer-stories$/);
    expect(form.links.inline).toContain('data-plaudit-form="customer-stories"');
    expect(form.links.iframe).toContain("/embed/acme/form/customer-stories");

    const list = await (await listRoute(req(`/api/admin/projects/${projectId}/forms`), params({ id: projectId }))).json();
    expect(list.forms.map((f: { name: string }) => f.name)).toEqual(["Default form", "Customer stories"]);
    expect(list.forms[1].stats).toEqual({ submissions: 0, invites: 0, responded: 0, responseRate: 0 });

    const pages = [...form.config.pages];
    const patched = await patchRoute(
      req(`/api/admin/forms/${form.id}`, { method: "PATCH", json: { name: "Stories", language: "ar", status: "paused", pages } }),
      id(form.id),
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).form).toMatchObject({ name: "Stories", language: "ar", status: "paused" });

    const bad = await patchRoute(req(`/api/admin/forms/${form.id}`, { method: "PATCH", json: { pages: [] } }), id(form.id));
    expect(bad.status).toBe(400);
    const badLanguage = await patchRoute(req(`/api/admin/forms/${form.id}`, { method: "PATCH", json: { language: "xx" } }), id(form.id));
    expect(badLanguage.status).toBe(400);

    const t = createTestimonial(projectId, { name: "Kept", text: "Still here", formId: form.id });
    expect((await deleteRoute(req(`/api/admin/forms/${form.id}`, { method: "DELETE" }), id(form.id))).status).toBe(200);
    expect(getTestimonial(t.id)?.formId).toBeNull();
    expect((await getRoute(req(`/api/admin/forms/${form.id}`), id(form.id))).status).toBe(404);
  });

  it("FORM-01 the default form can't be deleted", async () => {
    const def = getDefaultForm(projectId);
    const res = await deleteRoute(req(`/api/admin/forms/${def.id}`, { method: "DELETE" }), id(def.id));
    expect(res.status).toBe(409);
  });

  it("FORM-01 duplicates and switches the default; the mirror follows", async () => {
    const { body } = await create({ name: "Second", template: "local" });
    const dup = await duplicateRoute(req(`/api/admin/forms/${body.form.id}/duplicate`, { method: "POST" }), id(body.form.id));
    expect(dup.status).toBe(201);
    expect((await dup.json()).form).toMatchObject({ name: "Second (copy)", slug: "second-copy", isDefault: false });

    const res = await defaultRoute(req(`/api/admin/forms/${body.form.id}/default`, { method: "POST" }), id(body.form.id));
    expect((await res.json()).form.isDefault).toBe(true);
    expect(getDefaultForm(projectId).id).toBe(body.form.id);
    // The project's columns now mirror the new default's main question.
    expect(getProjectById(projectId)!.prompt).toBe("What was your visit like?");
  });

  it("FORM-10 changing the slug keeps the old link working", async () => {
    const { body } = await create({ name: "Stories" });
    const res = await slugRoute(req(`/api/admin/forms/${body.form.id}/slug`, { method: "POST", json: { slug: "love" } }), id(body.form.id));
    expect((await res.json()).form.slug).toBe("love");
    expect(getFormBySlug(projectId, "stories")).toMatchObject({ redirectedFrom: "stories", form: { id: body.form.id } });
    await create({ name: "Taken", slug: "taken" });
    const clash = await slugRoute(req(`/api/admin/forms/${body.form.id}/slug`, { method: "POST", json: { slug: "taken" } }), id(body.form.id));
    expect(clash.status).toBe(409);
  });

  it("FORM-01 switches a classic form to step by step", async () => {
    const def = getDefaultForm(projectId);
    expect(def.layout).toBe("classic");
    // A classic form refuses what the classic page can't show.
    const refused = await patchRoute(req(`/api/admin/forms/${def.id}`, { method: "PATCH", json: { language: "es" } }), id(def.id));
    expect(refused.status).toBe(409);
    const res = await upgradeRoute(req(`/api/admin/forms/${def.id}/upgrade`, { method: "POST" }), id(def.id));
    expect((await res.json()).form.layout).toBe("steps");
    expect((await patchRoute(req(`/api/admin/forms/${def.id}`, { method: "PATCH", json: { language: "es" } }), id(def.id))).status).toBe(200);
  });

  it("FORM-08 takes a logo by its bytes and refuses SVG", async () => {
    const { body } = await create({ name: "Logo" });
    const upload = (file: File) => {
      const data = new FormData();
      data.set("logo", file);
      return logoRoute(req(`/api/admin/forms/${body.form.id}/logo`, { method: "POST", body: data }), id(body.form.id));
    };
    const svg = await upload(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "logo.png", { type: "image/png" }));
    expect(svg.status).toBe(415);
    const ok = await upload(new File([PNG_BYTES], "logo.png", { type: "image/png" }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).form.logoUrl).toMatch(/^\/api\/media\/images\/.+\.png$/);
    const removed = await logoDelete(req(`/api/admin/forms/${body.form.id}/logo`, { method: "DELETE" }), id(body.form.id));
    expect((await removed.json()).form.logoUrl).toBeNull();
  });

  it("FORM-18 lists the templates", async () => {
    const res = await templatesRoute(req("/api/admin/form-templates"));
    expect((await res.json()).templates).toHaveLength(8);
  });

  it("FORM-01 needs a session and refuses cross-site changes (CSRF)", async () => {
    const anon = await createRoute(
      new Request(`http://localhost/api/admin/projects/${projectId}/forms`, { method: "POST", body: JSON.stringify({ name: "X" }) }),
      params({ id: projectId }),
    );
    expect(anon.status).toBe(401);
    const crossSite = await createRoute(
      new Request(`http://localhost/api/admin/projects/${projectId}/forms`, {
        method: "POST",
        body: JSON.stringify({ name: "X" }),
        headers: { cookie: adminCookie(), "sec-fetch-site": "cross-site", "content-type": "application/json" },
      }),
      params({ id: projectId }),
    );
    expect(crossSite.status).toBe(403);
    const def = getDefaultForm(projectId);
    const crossDelete = await deleteRoute(
      new Request(`http://localhost/api/admin/forms/${def.id}`, { method: "DELETE", headers: { cookie: adminCookie(), "sec-fetch-site": "cross-site" } }),
      id(def.id),
    );
    expect(crossDelete.status).toBe(403);
  });
});
