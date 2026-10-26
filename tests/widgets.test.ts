import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as feed } from "@/app/api/widget/[slug]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/admin/projects/[id]/widgets/route";
import { DELETE as deleteRoute, GET as getRoute, PATCH as patchRoute } from "@/app/api/admin/widgets/[id]/route";
import { POST as duplicateRoute } from "@/app/api/admin/widgets/[id]/duplicate/route";
import { POST as previewRoute } from "@/app/api/admin/widgets/preview/route";
import { WIDGET_LAYOUTS } from "@/db/schema";
import { createForm } from "@/lib/forms";
import { createProject, createTestimonial, updateTestimonial } from "@/lib/testimonials";
import {
  createWidget,
  defaultWidgetConfig,
  deleteWidget,
  duplicateWidget,
  getLiveWidget,
  LAYOUTS,
  listWidgets,
  newWidgetId,
  placementHint,
  PLATFORM_GUIDES,
  toPublicWidget,
  updateWidget,
  WIDGET_ID,
  widgetConfig,
  widgetSnippets,
} from "@/lib/widgets";
import { adminHeaders, params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => ctx.cleanup());

/** Every key anywhere in a JSON value. */
function keys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keys(x, out));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keys(x, out);
    }
  return out;
}

const json = (body: unknown) => ({ method: "POST", headers: { ...adminHeaders(), "content-type": "application/json" }, body: JSON.stringify(body) });

describe("widgets lib", () => {
  it("DISP-01 ids are w_ plus 12 base36 characters and never look like a slug", () => {
    const ids = new Set(Array.from({ length: 200 }, newWidgetId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(WIDGET_ID);
    expect(LAYOUTS).toEqual(WIDGET_LAYOUTS);
  });

  it("DISP-12 creates, lists, updates, duplicates and soft-deletes", () => {
    const w = createWidget(projectId, { name: "Home marquee", layout: "marquee", placement: "home" });
    expect(widgetConfig(w)).toEqual(defaultWidgetConfig("marquee"));
    const changed = updateWidget(w.id, { name: "Hero", config: { ...defaultWidgetConfig("marquee"), design: { ...defaultWidgetConfig().design, theme: "dark" } } });
    expect(changed!.name).toBe("Hero");
    expect(widgetConfig(changed!).design.theme).toBe("dark");
    const copy = duplicateWidget(w.id)!;
    expect(copy.id).not.toBe(w.id);
    expect(copy.name).toBe("Hero (copy)");
    expect(widgetConfig(copy)).toEqual(widgetConfig(changed!));
    expect(listWidgets(projectId).map((x) => x.id)).toEqual([w.id, copy.id]);
    expect(deleteWidget(w.id)).toBe(true);
    expect(getLiveWidget(w.id)).toBeNull();
    expect(listWidgets(projectId).map((x) => x.id)).toEqual([copy.id]);
    expect(deleteWidget(w.id)).toBe(false);
  });

  it("DISP-06 refuses a connected form from another project", () => {
    const other = createProject({ name: "Other", slug: "other" }).id;
    const form = createForm(other, { name: "Theirs" });
    expect(() => createWidget(projectId, { name: "W", layout: "grid", connectedFormId: form.id })).toThrow(/this project's forms/);
  });

  it("DISP-03 toPublicWidget is a whitelist: no filters, picks, form id or any key containing email", () => {
    const cfg = defaultWidgetConfig("grid");
    cfg.selection = { mode: "manual", manualIds: ["secret-id"], pinnedIds: ["secret-pin"] };
    cfg.filters = { ...cfg.filters, include: ["secret-keyword"], formId: "secret-form" };
    const pub = toPublicWidget({ id: "w_000000000000" }, cfg, { cta: null, wallUrl: "/wall/acme" });
    const raw = JSON.stringify(pub);
    for (const s of ["secret-id", "secret-pin", "secret-keyword", "secret-form", "firstNameOnly"]) expect(raw).not.toContain(s);
    expect(keys(pub).filter((k) => /email/i.test(k))).toEqual([]);
    expect(pub.cta).toBeNull();
  });

  it("DISP-09 share snippets point at this server and the widget id", () => {
    const s = widgetSnippets("https://plaudit.example/", "w_abcdefabcdef");
    expect(s.script).toBe('<script src="https://plaudit.example/widget.js" data-widget="w_abcdefabcdef" async></script>');
    expect(s.hosted).toBe("https://plaudit.example/embed/w_abcdefabcdef");
    expect(s.iframe).toContain('src="https://plaudit.example/embed/w_abcdefabcdef"');
    expect(s.iframe).toContain('e.origin==="https://plaudit.example"');
    expect(s.react).toContain('s.dataset.widget = id;');
    expect(s.html).toBe("https://plaudit.example/api/widget/w_abcdefabcdef/html");
    expect(PLATFORM_GUIDES.map((g) => g.id)).toEqual(["wordpress", "webflow", "framer", "wix", "squarespace", "shopify", "ghost", "notion", "nextjs"]);
  });

  it("DISP-15 suggests layouts from the placement", () => {
    expect(placementHint("pricing")).toEqual({ layouts: ["badge", "carousel"], text: "Recommended for a pricing page: rating badge or carousel." });
    expect(placementHint(null)).toBeNull();
    expect(placementHint("nowhere")).toBeNull();
  });
});

describe("GET /api/widget/w_…", () => {
  it("DISP-01 answers with the widget, its testimonials and the aggregate, cross-origin and cacheable", async () => {
    const t = createTestimonial(projectId, { name: "Ada Lovelace", email: "ada@example.com", text: "Superb", rating: 5 });
    updateTestimonial(t.id, { status: "approved" });
    const w = createWidget(projectId, { name: "W", layout: "carousel", config: { aggregate: { show: true, scope: "all" } } });
    const res = await feed(new Request(`http://localhost/api/widget/${w.id}`), params({ slug: w.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, stale-while-revalidate=300");
    const raw = await res.text();
    expect(raw).not.toContain("ada@example.com");
    expect(keys(JSON.parse(raw)).filter((k) => /email|consent|custom|hidden/i.test(k))).toEqual([]);
    const body = JSON.parse(raw);
    expect(Object.keys(body).sort()).toEqual(["aggregate", "project", "testimonials", "widget"]);
    expect(body.project).toEqual({ name: "Acme", slug: "acme", accentColor: "#0f766e" });
    expect(body.widget).toMatchObject({ id: w.id, layout: "carousel", aggregate: { show: true }, wallUrl: "/wall/acme" });
    expect(body.aggregate).toEqual({ count: 1, average: 5 });
    expect(body.testimonials[0]).toMatchObject({ name: "Ada Lovelace", text: "Superb" });
  });

  it("DISP-01 a deleted widget gives an empty payload, an unknown id a 404", async () => {
    const w = createWidget(projectId, { name: "W", layout: "grid" });
    deleteWidget(w.id);
    const res = await feed(new Request(`http://localhost/api/widget/${w.id}`), params({ slug: w.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ project: null, widget: null, testimonials: [], aggregate: { count: 0, average: null } });
    const missing = await feed(new Request("http://localhost/api/widget/w_zzzzzzzzzzzz"), params({ slug: "w_zzzzzzzzzzzz" }));
    expect(missing.status).toBe(404);
  });

  it("DISP-06 the CTA carries the connected form's links only while it's on", async () => {
    const form = createForm(projectId, { name: "Stories" });
    const w = createWidget(projectId, { name: "W", layout: "grid", connectedFormId: form.id, config: { cta: { enabled: true, mode: "popup" } } });
    const body = await (await feed(new Request(`http://localhost/api/widget/${w.id}`), params({ slug: w.id }))).json();
    expect(body.widget.cta).toEqual({ mode: "popup", url: `/f/acme/${form.slug}`, embedUrl: `/embed/acme/form/${form.slug}` });
    expect(JSON.stringify(body.widget)).not.toContain(form.id);
  });
});

describe("admin widget routes", () => {
  it("DISP-12 list, create, read, patch, duplicate and delete through the API", async () => {
    const created = await createRoute(new Request("http://localhost/x", json({ name: "Pricing badge", layout: "badge", placement: "pricing" })), params({ id: projectId }));
    expect(created.status).toBe(201);
    const { widget } = await created.json();
    expect(widget).toMatchObject({ name: "Pricing badge", layout: "badge", placement: "pricing" });
    expect(widget.config.layout).toBe("badge");

    const listed = await (await listRoute(new Request("http://localhost/x", { headers: adminHeaders() }), params({ id: projectId }))).json();
    expect(listed.widgets.map((w: { id: string }) => w.id)).toEqual([widget.id]);

    const bad = await patchRoute(
      new Request("http://localhost/x", { ...json({ config: { ...widget.config, design: { radius: 99 } } }), method: "PATCH" }),
      params({ id: widget.id }),
    );
    expect(bad.status).toBe(400);
    const ok = await patchRoute(
      new Request("http://localhost/x", { ...json({ name: "Badge", config: { ...widget.config, layout: "toast" } }), method: "PATCH" }),
      params({ id: widget.id }),
    );
    expect((await ok.json()).widget).toMatchObject({ name: "Badge", layout: "toast" });

    const dup = await duplicateRoute(new Request("http://localhost/x", json({})), params({ id: widget.id }));
    expect(dup.status).toBe(201);

    const del = await deleteRoute(new Request("http://localhost/x", { method: "DELETE", headers: adminHeaders() }), params({ id: widget.id }));
    expect(del.status).toBe(200);
    expect((await getRoute(new Request("http://localhost/x", { headers: adminHeaders() }), params({ id: widget.id }))).status).toBe(404);
  });

  it("DISP-12 needs a session and a same-site request", async () => {
    const res = await createRoute(new Request("http://localhost/x", { method: "POST", body: "{}" }), params({ id: projectId }));
    expect(res.status).toBe(401);
  });

  it("DISP-03 the preview draws an unsaved config and is never cached", async () => {
    const t = createTestimonial(projectId, { name: "Grace Hopper", text: "Yes", rating: 4 });
    updateTestimonial(t.id, { status: "approved" });
    const cfg = defaultWidgetConfig("list");
    cfg.design.firstNameOnly = true;
    const res = await previewRoute(new Request("http://localhost/x", json({ projectId, config: cfg })));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.widget.layout).toBe("list");
    expect(body.testimonials.map((x: { name: string }) => x.name)).toEqual(["Grace"]);
  });
});
