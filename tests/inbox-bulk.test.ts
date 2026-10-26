import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as bulkRoute } from "@/app/api/admin/projects/[id]/testimonials/bulk/route";
import { getDb, schema } from "@/db";
import { listHistory } from "@/lib/history";
import { BulkError, bulkUpdate, MAX_BULK } from "@/lib/inbox";
import { createProject, createTestimonial, getTestimonial, updateTestimonial } from "@/lib/testimonials";
import { trashTestimonial } from "@/lib/trash";
import { ADMIN_EMAIL, adminHeaders, params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;
let otherId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  otherId = createProject({ name: "Other", slug: "other" }).id;
  // A catch-all webhook: no events selected.
  getDb()
    .insert(schema.webhooks)
    .values({ id: "hook", url: "http://127.0.0.1:9/hook", secret: "whsec_x", events: "[]", active: true, createdAt: new Date() })
    .run();
});
afterEach(() => ctx.cleanup());

const sent = () =>
  getDb()
    .select()
    .from(schema.webhookDeliveries)
    .all()
    .map((d) => d.event);
const clearSent = () => getDb().delete(schema.webhookDeliveries).run();
const make = (n: number, project = projectId) =>
  Array.from({ length: n }, (_, i) => createTestimonial(project, { name: `Person ${i}`, text: "Good", rating: 5 }).id);
const status = (id: string) => getTestimonial(id)?.status;

const post = (body: unknown, id = projectId) =>
  bulkRoute(
    new Request(`http://localhost/api/admin/projects/${id}/testimonials/bulk`, {
      method: "POST",
      headers: { ...adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params({ id }),
  );

describe("INBOX-06 bulk actions", () => {
  it("INBOX-06 approves 50 with one withdrawn: 49 approved, 1 skipped with the reason", async () => {
    const ids = make(50);
    getDb().update(schema.testimonials).set({ withdrawnAt: new Date(), status: "rejected" }).where(eq(schema.testimonials.id, ids[7])).run();
    clearSent();
    const res = await post({ action: "approve", ids });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toHaveLength(49);
    expect(body.skipped).toEqual([{ id: ids[7], reason: expect.stringContaining("withdrew") }]);
    expect(status(ids[7])).toBe("rejected");
    expect(ids.filter((id) => status(id) === "approved")).toHaveLength(49);
    // One webhook and one history entry per item, with who did it.
    expect(sent()).toEqual(Array(49).fill("testimonial.approved"));
    const statusEntries = (id: string) => listHistory(id).filter((h) => h.action === "status");
    expect(statusEntries(ids[0])).toHaveLength(1);
    expect(statusEntries(ids[0])[0].actorEmail).toBe(ADMIN_EMAIL);
    expect(statusEntries(ids[7])).toHaveLength(0);
  });

  it("INBOX-06 skips ids from another project and ones that don't exist", async () => {
    const [mine] = make(1);
    const [theirs] = make(1, otherId);
    const result = await bulkUpdate(projectId, [mine, theirs, "missing"], "hide");
    expect(result.updated).toEqual([mine]);
    expect(result.skipped.map((s) => s.id)).toEqual([theirs, "missing"]);
    expect(result.skipped[0].reason).toBe("Not a testimonial in this project");
    expect(status(theirs)).toBe("pending");
  });

  it("INBOX-06 hiding sends testimonial.hidden, never testimonial.rejected", async () => {
    const ids = make(3);
    clearSent();
    await bulkUpdate(projectId, ids, "hide");
    expect(sent()).toEqual(["testimonial.hidden", "testimonial.hidden", "testimonial.hidden"]);
    expect(ids.map(status)).toEqual(["hidden", "hidden", "hidden"]);
    // Already hidden ones are skipped, not sent again.
    clearSent();
    const again = await bulkUpdate(projectId, ids, "hide");
    expect(again.updated).toEqual([]);
    expect(again.skipped[0].reason).toBe("Already hidden");
    expect(sent()).toEqual([]);
  });

  it("INBOX-09 trash 2 and restore 1: the status comes back", async () => {
    const ids = make(3);
    updateTestimonial(ids[0], { status: "approved" });
    updateTestimonial(ids[1], { status: "hidden" });
    clearSent();
    expect((await bulkUpdate(projectId, ids.slice(0, 2), "trash")).updated).toHaveLength(2);
    expect(ids.map(status)).toEqual(["trashed", "trashed", "pending"]);
    // Approving a trashed row is refused until it's restored.
    const refused = await bulkUpdate(projectId, [ids[0]], "approve");
    expect(refused.skipped[0].reason).toMatch(/trash/);
    const back = await bulkUpdate(projectId, [ids[0], ids[2]], "restore");
    expect(back.updated).toEqual([ids[0]]);
    expect(back.skipped).toEqual([{ id: ids[2], reason: "Not in the trash" }]);
    expect(status(ids[0])).toBe("approved");
    expect(getTestimonial(ids[0])!.approvedBy).toBe("owner");
    expect(sent()).toEqual(["testimonial.trashed", "testimonial.trashed", "testimonial.restored"]);
  });

  it("INBOX-09 deletes for good only from the trash", async () => {
    const ids = make(2);
    trashTestimonial(ids[0]);
    const result = await bulkUpdate(projectId, ids, "delete");
    expect(result.updated).toEqual([ids[0]]);
    expect(result.skipped).toEqual([{ id: ids[1], reason: "Only testimonials in the trash can be deleted for good" }]);
    expect(getTestimonial(ids[0])).toBeNull();
    expect(status(ids[1])).toBe("pending");
  });

  it("INBOX-06 tags and untags, keeping the other tags", async () => {
    const ids = make(2);
    updateTestimonial(ids[0], { tags: ["home"] });
    const tagged = await bulkUpdate(projectId, ids, "tag", { tags: ["Pricing", "home"] });
    expect(tagged.updated).toEqual(ids);
    expect(getTestimonial(ids[0])!.tags).toEqual(["home", "pricing"]);
    expect(getTestimonial(ids[1])!.tags).toEqual(["home", "pricing"]);
    const again = await bulkUpdate(projectId, ids, "tag", { tags: ["pricing"] });
    expect(again.skipped.map((s) => s.reason)).toEqual(["Already has these tags", "Already has these tags"]);
    await bulkUpdate(projectId, [ids[0]], "untag", { tags: ["home"] });
    expect(getTestimonial(ids[0])!.tags).toEqual(["pricing"]);
    expect(listHistory(ids[0]).filter((h) => h.action === "tags")).toHaveLength(3);
    await expect(bulkUpdate(projectId, ids, "tag")).rejects.toBeInstanceOf(BulkError);
  });

  it("INBOX-06 a private-consent row can't be approved but can be hidden", async () => {
    const [id] = make(1);
    getDb().update(schema.testimonials).set({ consentPublic: false }).where(eq(schema.testimonials.id, id)).run();
    expect((await bulkUpdate(projectId, [id], "approve")).skipped[0].reason).toBe("The author asked to keep it private");
    expect((await bulkUpdate(projectId, [id], "hide")).updated).toEqual([id]);
  });

  it("INBOX-06 caps a request at 500 ids", async () => {
    const tooMany = Array.from({ length: MAX_BULK + 1 }, (_, i) => `id-${i}`);
    await expect(bulkUpdate(projectId, tooMany, "approve")).rejects.toThrow(/at most 500/);
    expect((await post({ action: "approve", ids: tooMany })).status).toBe(400);
    expect((await post({ action: "approve", ids: [] })).status).toBe(400);
    expect((await post({ action: "explode", ids: ["a"] })).status).toBe(400);
    expect((await post({ action: "approve", ids: ["a"] }, "nope")).status).toBe(404);
    // Exactly 500 is fine (each simply skipped here).
    const ok = await post({ action: "approve", ids: tooMany.slice(0, MAX_BULK) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).skipped).toHaveLength(MAX_BULK);
  });
});
