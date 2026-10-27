import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createHookRoute } from "@/app/api/admin/webhooks/route";
import { PATCH as patchHookRoute } from "@/app/api/admin/webhooks/[id]/route";
import { getDb, schema } from "@/db";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/db/schema";
import { createProject, createTestimonial, getProjectById, getTestimonial, updateTestimonial } from "@/lib/testimonials";
import { trashTestimonial, restoreTestimonial } from "@/lib/trash";
import { DEFAULT_EVENTS, emitEvent, emitTestimonialEvent, registerEventListener, subscribers, type EventContext } from "@/lib/webhooks";
import { adminHeaders, params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  heard.length = 0;
});
afterEach(() => ctx.cleanup());

function hook(events: WebhookEvent[] = [], extra: Partial<typeof schema.webhooks.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  getDb()
    .insert(schema.webhooks)
    .values({ id, url: "http://127.0.0.1:9/hook", secret: "whsec_x", events: JSON.stringify(events), active: true, createdAt: new Date(), ...extra })
    .run();
  return id;
}

/** [hook id, event] for every queued delivery, in order. */
const deliveries = () =>
  getDb()
    .select()
    .from(schema.webhookDeliveries)
    .all()
    .map((d) => [d.webhookId, d.event]);

function addForm(id = crypto.randomUUID()) {
  getDb().insert(schema.forms).values({ id, projectId, slug: `f-${id.slice(0, 8)}`, name: "Form" }).run();
  return id;
}

const heard: [WebhookEvent, EventContext][] = [];
registerEventListener((event, c) => {
  heard.push([event, c]);
});

describe("D7 default events", () => {
  it("are the original six plus hidden, trashed and restored", () => {
    expect([...DEFAULT_EVENTS]).toEqual([
      "testimonial.created",
      "testimonial.approved",
      "testimonial.rejected",
      "testimonial.deleted",
      "testimonial.transcribed",
      "consent.withdrawn",
      "testimonial.hidden",
      "testimonial.trashed",
      "testimonial.restored",
    ]);
    expect(DEFAULT_EVENTS.every((e) => WEBHOOK_EVENTS.includes(e as (typeof WEBHOOK_EVENTS)[number]))).toBe(true);
  });

  it("a hook with no events gets takedowns, but not form.submitted or testimonial.updated", () => {
    const all = hook();
    const id = createTestimonial(projectId, { name: "Ada", text: "Good" }).id;
    updateTestimonial(id, { status: "approved" });
    updateTestimonial(id, { text: "Very good" });
    updateTestimonial(id, { status: "hidden" });
    trashTestimonial(id);
    restoreTestimonial(id);
    emitEvent("form.submitted", getProjectById(projectId), { form: { id: "f" } });
    emitEvent("import.completed", getProjectById(projectId), { imported: 3 });
    expect(deliveries()).toEqual([
      [all, "testimonial.approved"],
      [all, "testimonial.hidden"],
      [all, "testimonial.trashed"],
      [all, "testimonial.restored"],
    ]);
  });

  it("a hook that selects the opt-in events gets them", () => {
    const optIn = hook(["testimonial.updated", "form.submitted"]);
    const id = createTestimonial(projectId, { name: "Ada", text: "Good" }).id;
    updateTestimonial(id, { status: "approved" });
    updateTestimonial(id, { tags: ["home"] });
    updateTestimonial(id, { headline: "Hours saved" });
    emitEvent("form.submitted", getProjectById(projectId), { form: { id: "f" } });
    // Status and tag changes aren't content edits.
    expect(deliveries()).toEqual([
      [optIn, "testimonial.updated"],
      [optIn, "form.submitted"],
    ]);
    const body = JSON.parse(getDb().select().from(schema.webhookDeliveries).all()[0].payload);
    expect(body).toMatchObject({ event: "testimonial.updated", project: { slug: "acme" }, data: { testimonial: { id, headline: "Hours saved" } } });
  });

  it("selected events still win over the defaults", () => {
    hook(["testimonial.approved"]);
    const id = createTestimonial(projectId, { name: "Ada", text: "Good" }).id;
    trashTestimonial(id);
    expect(deliveries()).toEqual([]);
  });
});

describe("FORM-10 per-form webhooks", () => {
  it("subscribers keep a form's hook to that form's testimonials", () => {
    const formA = addForm();
    const formB = addForm();
    const everyForm = hook();
    const onlyA = hook([], { projectId, formId: formA });
    const ids = (formId: string | null) => subscribers("testimonial.created", projectId, formId).map((w) => w.id).sort();
    expect(ids(formA)).toEqual([everyForm, onlyA].sort());
    expect(ids(formB)).toEqual([everyForm]);
    expect(ids(null)).toEqual([everyForm]);
  });

  it("testimonial events carry their form", () => {
    const formA = addForm();
    const onlyA = hook([], { projectId, formId: formA });
    const a = createTestimonial(projectId, { name: "A", text: "x", formId: formA }).id;
    const other = createTestimonial(projectId, { name: "B", text: "y" }).id;
    emitTestimonialEvent("testimonial.created", getTestimonial(a));
    emitTestimonialEvent("testimonial.created", getTestimonial(other));
    expect(deliveries()).toEqual([[onlyA, "testimonial.created"]]);
  });

  it("are deleted with their form", () => {
    const formA = addForm();
    hook([], { projectId, formId: formA });
    getDb().delete(schema.forms).where(eq(schema.forms.id, formA)).run();
    expect(getDb().select().from(schema.webhooks).all()).toEqual([]);
  });

  it("are set through the admin API, which checks the form and keeps it in its project", async () => {
    const other = createProject({ name: "Other", slug: "other" }).id;
    const formA = addForm();
    const req = (body: unknown, url = "/api/admin/webhooks", method = "POST") =>
      new Request(`http://localhost${url}`, { method, headers: { ...adminHeaders(), "content-type": "application/json" }, body: JSON.stringify(body) });

    const unknown = await createHookRoute(req({ url: "https://example.com/h", formId: "nope" }));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toBe("Unknown form");
    const mismatch = await createHookRoute(req({ url: "https://example.com/h", projectId: other, formId: formA }));
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json()).error).toBe("That form belongs to another project");

    const created = await createHookRoute(req({ url: "https://example.com/h", formId: formA }));
    expect(created.status).toBe(201);
    const { webhook } = await created.json();
    expect(webhook).toMatchObject({ formId: formA, projectId });

    // Moving it to another project lets go of the form.
    const moved = await patchHookRoute(req({ projectId: other }, `/api/admin/webhooks/${webhook.id}`, "PATCH"), params({ id: webhook.id }));
    expect((await moved.json()).webhook).toMatchObject({ projectId: other, formId: null });
    const back = await patchHookRoute(req({ formId: formA }, `/api/admin/webhooks/${webhook.id}`, "PATCH"), params({ id: webhook.id }));
    expect((await back.json()).webhook).toMatchObject({ projectId, formId: formA });
  });
});

describe("event listeners", () => {
  it("hear every testimonial event with its project and form, quiet or not", () => {
    const formA = addForm();
    const id = createTestimonial(projectId, { name: "Ada", text: "Good", formId: formA }).id;
    updateTestimonial(id, { status: "approved" });
    updateTestimonial(id, { status: "rejected" }, { quiet: true });
    emitEvent("import.completed", getProjectById(projectId), { imported: 1 }, { quiet: true });
    expect(heard.map(([e, c]) => [e, c.project.id, c.formId, c.quiet, c.testimonial?.id ?? null])).toEqual([
      ["testimonial.approved", projectId, formA, false, id],
      ["import.completed", projectId, null, true, null],
    ]);
  });

  it("never break the change that sent the event", () => {
    registerEventListener(() => {
      throw new Error("listener down");
    });
    hook();
    const id = createTestimonial(projectId, { name: "Ada", text: "Good" }).id;
    expect(updateTestimonial(id, { status: "approved" })).toMatchObject({ status: "approved" });
    expect(deliveries()).toHaveLength(1);
  });
});
