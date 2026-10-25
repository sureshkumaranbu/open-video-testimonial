import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE as deleteRoute, PATCH as patchRoute } from "@/app/api/admin/testimonials/[id]/route";
import { POST as restoreRoute } from "@/app/api/admin/testimonials/[id]/restore/route";
import { POST as trashRoute } from "@/app/api/admin/testimonials/[id]/trash/route";
import { getDb, schema } from "@/db";
import { grantConsent, listConsentEvents, withdrawConsent } from "@/lib/consent";
import { listHistory } from "@/lib/history";
import { resolveKey, saveFile } from "@/lib/storage";
import {
  ConsentWithdrawnError,
  countByStatus,
  createProject,
  createTestimonial,
  deleteTestimonial,
  getProjectById,
  getTestimonial,
  listPublicTestimonials,
  NoPublicConsentError,
  updateTestimonial,
} from "@/lib/testimonials";
import { NotInTrashError, purgeTrash, restoreTestimonial, trashTestimonial } from "@/lib/trash";
import { ADMIN_EMAIL, adminHeaders, params, PNG_BYTES, useTempDataDir, WEBM_BYTES } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  // A catch-all webhook: no events selected.
  getDb()
    .insert(schema.webhooks)
    .values({ id: "hook", url: "http://127.0.0.1:9/hook", secret: "whsec_x", events: "[]", active: true, createdAt: new Date() })
    .run();
});
afterEach(() => {
  delete process.env.TRASH_RETENTION_DAYS;
  ctx.cleanup();
});

/** The events queued for delivery, in order. */
const sent = () =>
  getDb()
    .select()
    .from(schema.webhookDeliveries)
    .all()
    .map((d) => d.event);

const newOne = (name = "Ada") => createTestimonial(projectId, { name, text: "It saved us hours.", rating: 5 }).id;

const admin = (url: string, method: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { ...adminHeaders(), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const trash = (id: string) => trashRoute(admin(`/api/admin/testimonials/${id}/trash`, "POST"), params({ id }));
const restore = (id: string) => restoreRoute(admin(`/api/admin/testimonials/${id}/restore`, "POST"), params({ id }));

async function stored(bytes: Uint8Array, mime: string, kind: "video" | "image") {
  const tmp = path.join(ctx.dir, `src-${Math.random()}`);
  fs.writeFileSync(tmp, bytes);
  return (await saveFile(tmp, mime, kind)).key;
}

const exists = (key: string) => fs.existsSync(resolveKey(key));

describe("status events", () => {
  it("INBOX-01 sends testimonial.hidden (and nothing else) when one is hidden", async () => {
    const id = newOne();
    updateTestimonial(id, { status: "approved" });
    const res = await patchRoute(admin(`/api/admin/testimonials/${id}`, "PATCH", { status: "hidden" }), params({ id }));
    expect(res.status).toBe(200);
    expect(getTestimonial(id)).toMatchObject({ status: "hidden", approvedBy: null, approvedAt: null });
    expect(sent()).toEqual(["testimonial.approved", "testimonial.hidden"]);
    expect(listPublicTestimonials(projectId)).toEqual([]);
  });

  it("maps every status change to its own event; pending sends none and quiet sends nothing", () => {
    const id = newOne();
    for (const status of ["approved", "rejected", "pending", "hidden", "trashed", "pending"] as const) {
      updateTestimonial(id, { status });
    }
    updateTestimonial(id, { status: "approved" }, { quiet: true });
    expect(sent()).toEqual([
      "testimonial.approved",
      "testimonial.rejected",
      "testimonial.hidden",
      "testimonial.trashed",
      "testimonial.restored",
    ]);
  });

  it("sends nothing when the status doesn't change", () => {
    const id = newOne();
    updateTestimonial(id, { status: "pending" });
    updateTestimonial(id, { status: "approved" });
    updateTestimonial(id, { status: "approved" });
    expect(sent()).toEqual(["testimonial.approved"]);
  });

  it("counts every status", () => {
    const ids = [newOne("A"), newOne("B"), newOne("C"), newOne("D")];
    updateTestimonial(ids[0], { status: "approved" });
    updateTestimonial(ids[1], { status: "hidden" });
    trashTestimonial(ids[2]);
    expect(countByStatus(projectId)).toEqual({ pending: 1, approved: 1, rejected: 0, hidden: 1, trashed: 1 });
  });
});

describe("INBOX-09 trash and restore", () => {
  it("takes a testimonial off the public pages, then puts it back exactly as it was", async () => {
    const id = newOne();
    updateTestimonial(id, { status: "approved" }, { actor: "auto", rule: "4+ stars" });
    const approved = getTestimonial(id)!;
    expect(listPublicTestimonials(projectId).map((t) => t.id)).toEqual([id]);

    const res = await trash(id);
    expect(res.status).toBe(200);
    const trashed = (await res.json()).testimonial;
    expect(trashed).toMatchObject({ status: "trashed", statusBeforeTrash: "approved", trashedAt: expect.any(String) });
    expect(listPublicTestimonials(projectId)).toEqual([]);

    const back = await restore(id);
    expect(back.status).toBe(200);
    expect(getTestimonial(id)).toMatchObject({
      status: "approved",
      trashedAt: null,
      statusBeforeTrash: null,
      approvedBy: "auto",
      approvalRule: "4+ stars",
      approvedAt: approved.approvedAt,
    });
    expect(listPublicTestimonials(projectId).map((t) => t.id)).toEqual([id]);
    expect(sent()).toEqual(["testimonial.approved", "testimonial.trashed", "testimonial.restored"]);
    expect(listHistory(id).map((h) => [h.action, h.actorEmail])).toEqual([
      ["created", null],
      ["status", null],
      ["trashed", ADMIN_EMAIL],
      ["restored", ADMIN_EMAIL],
    ]);
  });

  it("restores pending, rejected and hidden ones to where they were", () => {
    for (const status of ["pending", "rejected", "hidden"] as const) {
      const id = newOne(status);
      updateTestimonial(id, { status });
      trashTestimonial(id);
      expect(restoreTestimonial(id)).toMatchObject({ status, trashedAt: null });
    }
  });

  it("brings a withdrawn testimonial back as rejected, and never published", () => {
    const id = newOne();
    updateTestimonial(id, { status: "approved" });
    withdrawConsent(id, { actor: "customer" });
    expect(() => updateTestimonial(id, { status: "hidden" })).toThrow(ConsentWithdrawnError);
    expect(() => updateTestimonial(id, { status: "approved" })).toThrow(ConsentWithdrawnError);
    expect(trashTestimonial(id)).toMatchObject({ status: "trashed", statusBeforeTrash: "rejected" });
    expect(restoreTestimonial(id)).toMatchObject({ status: "rejected", withdrawnAt: expect.any(Date) });
  });

  it("keeps a testimonial withdrawn while in the trash there, to come back as rejected", () => {
    const id = newOne();
    updateTestimonial(id, { status: "approved" });
    trashTestimonial(id);
    withdrawConsent(id, { actor: "customer" });
    expect(getTestimonial(id)).toMatchObject({ status: "trashed", statusBeforeTrash: "rejected", approvedBy: null });
    expect(restoreTestimonial(id)).toMatchObject({ status: "rejected" });
  });

  it("refuses to restore what isn't in the trash, and 404s what doesn't exist", async () => {
    const id = newOne();
    expect(() => restoreTestimonial(id)).toThrow(NotInTrashError);
    const res = await restore(id);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/isn't in the trash/);
    const missing = crypto.randomUUID();
    expect((await trash(missing)).status).toBe(404);
    expect((await restore(missing)).status).toBe(404);
  });

  it("trashing twice changes nothing", () => {
    const id = newOne();
    updateTestimonial(id, { status: "approved" });
    const first = trashTestimonial(id)!;
    expect(trashTestimonial(id)).toMatchObject({ status: "trashed", statusBeforeTrash: "approved", trashedAt: first.trashedAt });
    expect(sent()).toEqual(["testimonial.approved", "testimonial.trashed"]);
  });

  it("needs a signed-in, same-origin request", async () => {
    const id = newOne();
    const anon = new Request(`http://localhost/api/admin/testimonials/${id}/trash`, { method: "POST" });
    expect((await trashRoute(anon, params({ id }))).status).toBe(401);
    const cross = new Request(`http://localhost/api/admin/testimonials/${id}/trash`, {
      method: "POST",
      headers: { ...adminHeaders(), "sec-fetch-site": "cross-site" },
    });
    expect((await trashRoute(cross, params({ id }))).status).toBe(403);
    expect(getTestimonial(id)!.status).toBe("pending");
  });

  it("purges what has been in the trash longer than 30 days, with its files", async () => {
    const avatarKey = await stored(PNG_BYTES, "image/png", "image");
    const id = createTestimonial(projectId, { name: "Old", text: "Bye", avatarKey }).id;
    const keep = newOne("Recent");
    trashTestimonial(id);
    const now = Date.now();
    expect(await purgeTrash(new Date(now + 29 * 86_400_000))).toBe(0);
    expect(getTestimonial(id)).not.toBeNull();
    expect(await purgeTrash(new Date(now + 31 * 86_400_000))).toBe(1);
    expect(getTestimonial(id)).toBeNull();
    expect(exists(avatarKey)).toBe(false);
    expect(getTestimonial(keep)).not.toBeNull();
    expect(sent()).toEqual(["testimonial.trashed", "testimonial.deleted"]);
  });

  it("follows TRASH_RETENTION_DAYS", async () => {
    process.env.TRASH_RETENTION_DAYS = "7";
    const id = newOne();
    trashTestimonial(id);
    expect(await purgeTrash(new Date(Date.now() + 8 * 86_400_000))).toBe(1);
  });
});

describe("D11 private consent", () => {
  it("never approves a testimonial its author asked to keep private, but can hide it", async () => {
    const id = newOne();
    grantConsent({ testimonialId: id, project: getProjectById(projectId)!, scopes: [], public: false, actor: "customer" });
    expect(getTestimonial(id)!.consentPublic).toBe(false);
    expect(listConsentEvents(id)[0]).toMatchObject({ type: "granted", detail: expect.stringMatching(/private/) });
    expect(() => updateTestimonial(id, { status: "approved" })).toThrow(NoPublicConsentError);
    const res = await patchRoute(admin(`/api/admin/testimonials/${id}`, "PATCH", { status: "approved" }), params({ id }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/keep this testimonial private/);
    expect(updateTestimonial(id, { status: "hidden" })).toMatchObject({ status: "hidden" });
    expect(getTestimonial(id)).toMatchObject({ status: "hidden", approvedBy: null });
  });

  it("leaves consent public when the form doesn't ask", () => {
    const id = newOne();
    grantConsent({ testimonialId: id, project: getProjectById(projectId)!, scopes: ["social"], actor: "customer" });
    expect(getTestimonial(id)).toMatchObject({ consentPublic: true, consentScopes: '["website","social"]' });
  });
});

describe("deleting", () => {
  it("keeps the admin DELETE a hard delete", async () => {
    const id = newOne();
    const res = await deleteRoute(admin(`/api/admin/testimonials/${id}`, "DELETE"), params({ id }));
    expect(res.status).toBe(200);
    expect(getTestimonial(id)).toBeNull();
    expect(sent()).toEqual(["testimonial.deleted"]);
  });

  it("removes answer videos, images and the company logo, but not a customer's photo", async () => {
    const [avatarKey, logoKey, imageKey, posterKey] = await Promise.all([
      stored(PNG_BYTES, "image/png", "image"),
      stored(PNG_BYTES, "image/png", "image"),
      stored(PNG_BYTES, "image/png", "image"),
      stored(PNG_BYTES, "image/png", "image"),
    ]);
    const answerVideo = await stored(WEBM_BYTES, "video/webm", "video");
    const db = getDb();
    const customerId = crypto.randomUUID();
    db.insert(schema.customers).values({ id: customerId, projectId, name: "Ada", avatarKey }).run();
    const id = createTestimonial(projectId, { name: "Ada", text: "Hi", avatarKey, companyLogoKey: logoKey, customerId }).id;
    db.insert(schema.answers)
      .values({ id: crypto.randomUUID(), testimonialId: id, questionKey: "q2", questionTitle: "And then?", position: 1, videoKey: answerVideo, videoOriginalKey: answerVideo, posterKey })
      .run();
    db.insert(schema.testimonialImages).values({ id: crypto.randomUUID(), testimonialId: id, key: imageKey }).run();

    expect(await deleteTestimonial(id)).toBe(true);
    expect([logoKey, imageKey, posterKey, answerVideo].map(exists)).toEqual([false, false, false, false]);
    expect(exists(avatarKey)).toBe(true);
    expect(db.select().from(schema.answers).all()).toEqual([]);
    expect(db.select().from(schema.testimonialImages).all()).toEqual([]);
    expect(db.select().from(schema.testimonialHistory).all()).toEqual([]);
  });
});
