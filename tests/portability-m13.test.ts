import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import type { Project } from "@/db/schema";
import { insertFeedback } from "@/lib/feedback";
import { getDefaultForm } from "@/lib/forms";
import { insertImages } from "@/lib/images";
import { mergeTestimonials } from "@/lib/merge";
import { buildManifest, createImportTarget, exportZip, importArchive, readManifest } from "@/lib/portability";
import { createProject, createTestimonial, getProjectById, updateTestimonial } from "@/lib/testimonials";
import { env } from "@/lib/env";
import { saveFile } from "@/lib/storage";
import { saveTranslation } from "@/lib/translations";
import { registerJobs } from "@/lib/worker";
import { zipStream } from "@/lib/zip";
import { PNG_BYTES, useTempDataDir } from "./helpers";

/** L14: the zip export carries campaigns and their recipients, boosters and clicks, reward codes, and M13's tables. */

let ctx: ReturnType<typeof useTempDataDir>;
beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
});
afterEach(() => ctx.cleanup());

const db = () => getDb();
const now = new Date("2026-10-01T10:00:00Z");

async function exportTo(project: Project, file: string) {
  fs.writeFileSync(file, Buffer.from(await new Response(exportZip(project)).arrayBuffer()));
}
async function importAsNew(file: string) {
  const { manifest } = await readManifest(file);
  const target = createImportTarget(manifest, {});
  const counts = await importArchive(file, target.id);
  return { copy: getProjectById(target.id)!, counts };
}

async function png() {
  fs.mkdirSync(env.tmpDir, { recursive: true });
  const tmp = path.join(env.tmpDir, `png-${crypto.randomUUID()}`);
  fs.writeFileSync(tmp, PNG_BYTES);
  return (await saveFile(tmp, "image/png", "image", { move: true })).key;
}

async function seed() {
  const key = await png();
  const project = createProject({ name: "Acme", slug: "acme" });
  const form = getDefaultForm(project.id)!;
  const campaignId = crypto.randomUUID();
  db().insert(schema.campaigns).values({ id: campaignId, projectId: project.id, formId: form.id, name: "Spring", status: "active", subject: "Tell us", body: "Hi {{name}}", reminders: "[3,7]", trackOpens: true, rewardCodes: true, webhookTokenHash: "secret-hash", createdAt: now, updatedAt: now }).run();
  const recipient = crypto.randomUUID();
  db().insert(schema.requests).values({ id: recipient, projectId: project.id, email: "ada@example.com", name: "Ada", campaignId, title: "CTO", custom: '{"plan":"pro"}', sentAt: now, openedAt: now, clickedAt: now, createdAt: now }).run();
  const plain = crypto.randomUUID();
  db().insert(schema.requests).values({ id: plain, projectId: project.id, email: "bo@example.com", createdAt: now }).run();

  const a = createTestimonial(project.id, { name: "Ada", email: "ada@example.com", text: "First", language: "en" }).id;
  const b = createTestimonial(project.id, { name: "Ada", email: "ada@example.com", text: "Second" }).id;
  updateTestimonial(a, { status: "approved" }, { quiet: true });
  db().transaction((tx) => insertImages(tx, b, [{ questionKey: null, key }]));
  mergeTestimonials(project.id, b, a);
  saveTranslation(a, "fr", { headline: "Titre", text: "Premier" }, { machine: true });
  const [fb] = db().transaction((tx) => insertFeedback(tx, project.id, [{ formId: form.id, customerId: null, testimonialId: null, rating: 2, text: "Slow", authorName: "Bo", authorEmail: null }]));

  db().insert(schema.rewardCodes).values([
    { id: crypto.randomUUID(), projectId: project.id, formId: form.id, code: "GIFT-1", claimedAt: now, testimonialId: a, createdAt: now },
    { id: crypto.randomUUID(), projectId: project.id, formId: form.id, code: "GIFT-2", claimedAt: now, feedbackId: fb.id, createdAt: now },
    { id: crypto.randomUUID(), projectId: project.id, formId: form.id, code: "GIFT-3", requestId: recipient, createdAt: now },
    { id: crypto.randomUUID(), projectId: project.id, formId: form.id, code: "GIFT-4", createdAt: now },
  ]).run();

  const boosterId = crypto.randomUUID();
  const links = [
    { id: "g1", platform: "google", label: "", url: "https://g.page/r/acme/review", formId: null },
    { id: "f1", platform: "form", label: "Or tell us here", url: "", formId: form.id },
  ];
  db().insert(schema.boosters).values({ id: boosterId, projectId: project.id, slug: "reviews", name: "Reviews", published: true, title: "Love us?", links: JSON.stringify(links), design: "{}", createdAt: now, updatedAt: now }).run();
  db().insert(schema.boosterClicks).values([{ boosterId, linkId: "g1", day: "2026-09-30", count: 4 }, { boosterId, linkId: "f1", day: "2026-09-30", count: 1 }]).run();
  db().insert(schema.slugRedirects).values({ id: crypto.randomUUID(), kind: "booster", scope: project.id, projectId: project.id, boosterId, oldSlug: "old-reviews", createdAt: now }).run();
  db().insert(schema.importSources).values({ id: crypto.randomUUID(), projectId: project.id, adapter: "appstore", input: '{"id":"123456789","country":"us","apiKey":"leak"}', options: '{"minRating":4,"skipEmpty":false,"tags":["app"],"status":"approved"}', label: "123456789 · us", intervalHours: 12, itemsAdded: 7, createdAt: now, updatedAt: now }).run();
  db().insert(schema.importSources).values({ id: crypto.randomUUID(), projectId: project.id, adapter: "senja", input: "{}", options: "{}", createdAt: now, updatedAt: now }).run();
  return { project, a, b };
}

describe("L14 portability of campaigns, boosters, reward codes and M13 data", () => {
  it("L14 IMP-02 INBOX-11 INBOX-13 round-trips them, remapping every id, without secrets, with nothing sent or synced on arrival", async () => {
    const { project } = await seed();
    const manifest = buildManifest(project);
    expect(JSON.stringify(manifest)).not.toContain("secret-hash");
    expect(JSON.stringify(manifest)).not.toContain("leak");
    expect(manifest.testimonials.find((t) => t.text === "Second")!.mergedIntoId).toBeTruthy();

    const file = path.join(ctx.dir, "export.zip");
    await exportTo(project, file);
    const { copy, counts } = await importAsNew(file);
    expect(counts).toMatchObject({ campaigns: 1, boosters: 1, rewardCodes: 4, importSources: 1, translations: 1 });

    const campaign = db().select().from(schema.campaigns).where(eq(schema.campaigns.projectId, copy.id)).get()!;
    expect(campaign).toMatchObject({ name: "Spring", status: "paused", trackOpens: true, rewardCodes: true, webhookTokenHash: null, reminders: "[3,7]" });
    expect(campaign.formId).toBe(getDefaultForm(copy.id)!.id);
    const reqs = db().select().from(schema.requests).where(eq(schema.requests.projectId, copy.id)).all();
    const ada = reqs.find((r) => r.email === "ada@example.com")!;
    expect(ada).toMatchObject({ campaignId: campaign.id, title: "CTO", custom: '{"plan":"pro"}' });
    expect(ada.openedAt?.toISOString()).toBe(now.toISOString());
    expect(reqs.find((r) => r.email === "bo@example.com")!.campaignId).toBeNull();

    const booster = db().select().from(schema.boosters).where(eq(schema.boosters.projectId, copy.id)).get()!;
    expect(JSON.parse(booster.links)[1]).toMatchObject({ platform: "form", formId: getDefaultForm(copy.id)!.id });
    expect(db().select().from(schema.boosterClicks).where(eq(schema.boosterClicks.boosterId, booster.id)).all().map((c) => [c.linkId, c.count]).sort()).toEqual([["f1", 1], ["g1", 4]]);
    expect(db().select().from(schema.slugRedirects).where(eq(schema.slugRedirects.boosterId, booster.id)).get()?.oldSlug).toBe("old-reviews");

    const codes = db().select().from(schema.rewardCodes).where(eq(schema.rewardCodes.projectId, copy.id)).all();
    const mine = db().select().from(schema.testimonials).where(eq(schema.testimonials.projectId, copy.id)).all();
    const first = mine.find((t) => t.text === "First")!;
    const second = mine.find((t) => t.text === "Second")!;
    expect(codes.find((c) => c.code === "GIFT-1")!.testimonialId).toBe(first.id);
    expect(codes.find((c) => c.code === "GIFT-2")!.feedbackId).toBeTruthy();
    expect(codes.find((c) => c.code === "GIFT-3")!.requestId).toBe(ada.id);
    expect(codes.find((c) => c.code === "GIFT-4")!.claimedAt).toBeNull();

    expect(second).toMatchObject({ status: "trashed", mergedIntoId: first.id, statusBeforeTrash: "pending" });
    const images = db().select().from(schema.testimonialImages).where(eq(schema.testimonialImages.testimonialId, first.id)).all();
    expect(images.map((i) => i.ownerOnly)).toEqual([true]);
    expect(db().select().from(schema.translations).where(eq(schema.translations.testimonialId, first.id)).all()).toMatchObject([{ lang: "fr", text: "Premier", machine: true }]);

    const sources = db().select().from(schema.importSources).where(eq(schema.importSources.projectId, copy.id)).all();
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ adapter: "appstore", paused: true, intervalHours: 12, itemsAdded: 7 });
    expect(JSON.parse(sources[0].input)).toEqual({ id: "123456789", country: "us" });
    expect(db().select().from(schema.testimonialEmbeddings).all()).toEqual([]);
  });

  it("L14 an archive from before M13 (no campaigns, boosters, codes, sources or translations) still imports", async () => {
    const { project } = await seed();
    const manifest = buildManifest(project) as Record<string, unknown>;
    for (const k of ["campaigns", "boosters", "boosterClicks", "rewardCodes", "importSources"]) delete manifest[k];
    for (const t of manifest.testimonials as Record<string, unknown>[]) {
      delete t.translations;
      delete t.mergedIntoId;
      for (const i of t.images as Record<string, unknown>[]) delete i.ownerOnly;
    }
    for (const r of manifest.requests as Record<string, unknown>[]) for (const k of ["campaignId", "title", "custom", "scheduledFor", "openedAt", "clickedAt", "startedAt", "declinedAt"]) delete r[k];
    const file = path.join(ctx.dir, "old.zip");
    const out = fs.createWriteStream(file);
    for await (const chunk of zipStream([{ name: "plaudit.json", data: JSON.stringify(manifest) }])) out.write(chunk);
    await new Promise<void>((r) => out.end(() => r()));
    const { copy, counts } = await importAsNew(file);
    expect(counts).toMatchObject({ testimonials: 2, campaigns: 0, boosters: 0, rewardCodes: 0, importSources: 0, translations: 0 });
    expect(db().select().from(schema.requests).where(eq(schema.requests.projectId, copy.id)).all().every((r) => r.campaignId === null)).toBe(true);
  });
});
