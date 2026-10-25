import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { APPROVERS, type Project } from "@/db/schema";
import { insertAnswers, listAnswers } from "@/lib/answers";
import { listConsentEvents } from "@/lib/consent";
import { upsertCustomer } from "@/lib/customers";
import { countWords } from "@/lib/dates";
import { env } from "@/lib/env";
import { changeFormSlug, createForm, getDefaultForm, getFormBySlug, listForms, updateForm } from "@/lib/forms";
import { formConfigFromProject } from "@/lib/forms/defaults";
import { parseFormRow } from "@/lib/forms/schema";
import { listHighlights, setHighlights } from "@/lib/highlights";
import { listHistory } from "@/lib/history";
import {
  buildManifest,
  createImportTarget,
  exportZip,
  importArchive,
  LEGACY_STATUSES,
  readManifest,
} from "@/lib/portability";
import { createRequests } from "@/lib/requests";
import { resetStorage, saveFile } from "@/lib/storage";
import {
  createProject,
  createTestimonial,
  getProjectById,
  getTestimonial,
  isMediaPublic,
  listPublicTestimonials,
  listTestimonials,
  updateProject,
  updateTestimonial,
} from "@/lib/testimonials";
import { restoreTestimonial, trashTestimonial } from "@/lib/trash";
import { registerJobs } from "@/lib/worker";
import { extractEntry, openZip, zipStream } from "@/lib/zip";
import { createFakeS3 } from "./fixtures/fake-s3";
import { ADMIN_EMAIL, PNG_BYTES, SAMPLE_WEBM, useTempDataDir } from "./helpers";

/**
 * WP1.4: the zip export and import carry every Phase 1 table in format
 * version 1, old archives still import (and get a default form), and new
 * archives still validate for older versions.
 */

let ctx: ReturnType<typeof useTempDataDir>;

beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
});
afterEach(() => ctx.cleanup());

const { widgets, walls, seoSnippets, slugRedirects, feedback, customers, requests, testimonialImages, projects } = schema;

async function writeZip(file: string, entries: Parameters<typeof zipStream>[0]) {
  const out = fs.createWriteStream(file);
  for await (const chunk of zipStream(entries)) out.write(chunk);
  await new Promise<void>((r) => out.end(() => r()));
}

async function exportTo(project: Project, file: string) {
  fs.writeFileSync(file, Buffer.from(await new Response(exportZip(project)).arrayBuffer()));
}

async function readJson(file: string, entryName = "plaudit.json") {
  const zip = await openZip(file);
  const out = path.join(path.dirname(file), `read-${crypto.randomUUID()}`);
  await extractEntry(zip, zip.entries.get(entryName)!, out, 1e8);
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

/** Imports the archive as a new project, the way the import route and job do. */
async function importAsNew(file: string) {
  const { manifest } = await readManifest(file);
  const target = createImportTarget(manifest, {});
  const counts = await importArchive(file, target.id);
  return { copy: getProjectById(target.id)!, counts };
}

async function savePng() {
  const tmp = path.join(env.tmpDir, `png-${crypto.randomUUID()}`);
  fs.mkdirSync(env.tmpDir, { recursive: true });
  fs.writeFileSync(tmp, PNG_BYTES);
  return saveFile(tmp, "image/png", "image", { move: true });
}

const onDisk = (key: string | null) => Boolean(key) && fs.existsSync(path.join(env.uploadsDir, key!));
const one = <T>(rows: T[]) => {
  expect(rows).toHaveLength(1);
  return rows[0];
};

// The manifest schema as Plaudit shipped it before Phase 1 (f4e222f), to prove new archives still import there.
const legacyIso = z.iso.datetime({ offset: true });
const legacyNullableIso = legacyIso.nullable().optional();
const legacyManifestSchema = z.object({
  format: z.literal("plaudit-export"),
  version: z.literal(1),
  project: z.object({
    slug: z.string().max(48),
    name: z.string().min(1).max(80),
    prompt: z.string().max(300),
    thankYouMessage: z.string().max(300),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    allowVideo: z.boolean(),
    allowText: z.boolean(),
    questions: z.string().max(1200).default(""),
    maxVideoSeconds: z.number().int().min(15).max(600).default(120),
    consentText: z.string().max(1000).default(""),
    inviteSubject: z.string().max(200).default(""),
    inviteMessage: z.string().max(5000).default(""),
    reminderDays: z.string().max(40).default("3,7"),
    thankYouEmail: z.boolean().default(true),
    autoApprove: z.boolean().default(false),
    autoApproveMinRating: z.union([z.literal(4), z.literal(5)]).default(4),
    autoApproveVideo: z.boolean().default(false),
  }),
  consentVersions: z
    .array(z.object({ id: z.string(), version: z.number().int(), text: z.string(), hash: z.string(), createdAt: legacyIso }))
    .default([]),
  testimonials: z.array(
    z.object({
      id: z.string(),
      status: z.enum(["pending", "approved", "rejected"]),
      rating: z.number().int().min(1).max(5).nullable(),
      text: z.string().max(5000).nullable(),
      transcript: z.string().max(50_000).nullable().default(null),
      captionsVtt: z.string().max(200_000).nullable().default(null),
      author: z.object({
        name: z.string().min(1).max(120),
        email: z.string().max(254).nullable(),
        title: z.string().max(120).nullable(),
        company: z.string().max(120).nullable(),
      }),
      tags: z.array(z.string().max(32)).max(20).default([]),
      source: z.string().max(40).default("form"),
      requestId: z.string().nullable().default(null),
      approvedBy: z.enum(APPROVERS).nullable().default(null),
      approvedAt: legacyNullableIso,
      approvalRule: z.string().max(40).nullable().default(null),
      consent: z.object({
        at: legacyIso,
        scopes: z.array(z.string()).default(["website"]),
        editedAfterConsent: z.boolean().default(false),
        withdrawnAt: legacyNullableIso,
        events: z
          .array(
            z.object({
              type: z.enum(["granted", "edited", "withdrawn", "imported"]),
              actor: z.enum(["customer", "owner", "api", "import"]),
              versionId: z.string().nullable(),
              text: z.string().nullable(),
              textHash: z.string().nullable(),
              scopes: z.array(z.string()).nullable(),
              ipHash: z.string().nullable(),
              detail: z.string().nullable(),
              at: legacyIso,
            }),
          )
          .default([]),
      }),
      media: z.object({
        video: z.string().nullable(),
        videoMime: z.string().nullable().default(null),
        videoOriginal: z.string().nullable().default(null),
        poster: z.string().nullable().default(null),
        avatar: z.string().nullable().default(null),
        durationMs: z.number().int().nullable().default(null),
        width: z.number().int().nullable().default(null),
        height: z.number().int().nullable().default(null),
      }),
      createdAt: legacyIso,
      updatedAt: legacyIso,
    }),
  ),
  requests: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().max(120).nullable(),
        email: z.string().max(254),
        company: z.string().max(120).nullable(),
        status: z.enum(["waiting", "responded", "unsubscribed"]),
        sentAt: legacyNullableIso,
        remindersSent: z.number().int().default(0),
        respondedAt: legacyNullableIso,
        unsubscribedAt: legacyNullableIso,
        testimonialId: z.string().nullable(),
        createdAt: legacyIso,
      }),
    )
    .default([]),
});

/** plaudit.json exactly as a Plaudit server wrote it before Phase 1: no forms, no Phase 1 keys. */
const LEGACY_ARCHIVE = {
  format: "plaudit-export",
  version: 1,
  exportedAt: "2026-09-01T10:00:00.000Z",
  generator: "Plaudit",
  project: {
    slug: "oldco",
    name: "Old Co",
    prompt: "What did Old Co change for you?",
    thankYouMessage: "Thanks a lot!",
    accentColor: "#335577",
    allowVideo: true,
    allowText: true,
    questions: "What was hard before?\nWhat changed?",
    maxVideoSeconds: 90,
    consentText: "",
    inviteSubject: "",
    inviteMessage: "",
    reminderDays: "3,7",
    thankYouEmail: true,
    autoApprove: true,
    autoApproveMinRating: 5,
    autoApproveVideo: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  consentVersions: [{ id: "cv-1", version: 1, text: "You may show this on our website.", hash: "abc123", createdAt: "2026-01-01T00:00:00.000Z" }],
  testimonials: [
    {
      id: "t-1",
      status: "approved",
      rating: 5,
      text: "Old Co made our week easier.",
      transcript: null,
      captionsVtt: null,
      author: { name: "Ola", email: "ola@example.com", title: "CEO", company: "Ola Ltd" },
      tags: ["home"],
      source: "form",
      requestId: "r-1",
      approvedBy: "owner",
      approvedAt: "2026-02-02T00:00:00.000Z",
      approvalRule: null,
      consent: {
        at: "2026-02-01T00:00:00.000Z",
        scopes: ["website", "social"],
        editedAfterConsent: false,
        withdrawnAt: null,
        events: [
          {
            type: "granted",
            actor: "customer",
            versionId: "cv-1",
            text: "You may show this on our website.",
            textHash: "abc123",
            scopes: ["website", "social"],
            ipHash: null,
            detail: null,
            at: "2026-02-01T00:00:00.000Z",
          },
        ],
      },
      media: { video: null, videoMime: null, videoOriginal: null, poster: null, avatar: null, durationMs: null, width: null, height: null },
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-02T00:00:00.000Z",
    },
    {
      id: "t-2",
      status: "rejected",
      rating: null,
      text: "Sent in through the API.",
      transcript: null,
      captionsVtt: null,
      author: { name: "Api Person", email: null, title: null, company: null },
      tags: [],
      source: "api",
      requestId: null,
      approvedBy: null,
      approvedAt: null,
      approvalRule: null,
      consent: { at: "2026-03-01T00:00:00.000Z", scopes: ["website"], editedAfterConsent: false, withdrawnAt: null, events: [] },
      media: { video: null, videoMime: null, videoOriginal: null, poster: null, avatar: null, durationMs: null, width: null, height: null },
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    },
  ],
  requests: [
    {
      id: "r-1",
      name: "Ola",
      email: "ola@example.com",
      company: null,
      status: "responded",
      sentAt: "2026-01-20T00:00:00.000Z",
      remindersSent: 1,
      respondedAt: "2026-02-01T00:00:00.000Z",
      unsubscribedAt: null,
      testimonialId: "t-1",
      createdAt: "2026-01-20T00:00:00.000Z",
    },
  ],
};

describe("old archives", () => {
  it("an old v1 archive imports and gets a default form from its project settings", async () => {
    expect(legacyManifestSchema.safeParse(LEGACY_ARCHIVE).success).toBe(true); // the fixture really is the old format
    const file = path.join(ctx.dir, "old.zip");
    await writeZip(file, [{ name: "plaudit.json", data: JSON.stringify(LEGACY_ARCHIVE) }]);
    const { copy, counts } = await importAsNew(file);
    expect(counts).toMatchObject({ testimonials: 2, requests: 1, forms: 0, customers: 0, widgets: 0, walls: 0, media: 0 });

    const form = one(listForms(copy.id));
    expect(form).toMatchObject({ isDefault: true, layout: "classic", slug: "default", name: "Default form" });
    expect(parseFormRow(form)).toEqual(formConfigFromProject(copy));
    const question = parseFormRow(form).pages.find((p) => p.type === "question")!;
    expect(question).toMatchObject({ title: "What did Old Co change for you?", tips: ["What was hard before?", "What changed?"], maxVideoSeconds: 90 });
    expect(copy).toMatchObject({ autoApprove: true, autoApproveMinRating: 5, website: null, businessType: null, logoKey: null });

    const items = listTestimonials(copy.id);
    const ola = items.find((t) => t.authorName === "Ola")!;
    const api = items.find((t) => t.authorName === "Api Person")!;
    // As migration 0009 does: what came in through the collection page came through the default form.
    expect(ola.formId).toBe(form.id);
    expect(api.formId).toBeNull();
    expect(ola).toMatchObject({
      status: "approved",
      approvedBy: "owner",
      datePrecision: "day",
      consentPublic: true,
      platform: null,
      headline: null,
      customerId: null,
      customFields: "{}",
      hiddenFields: "{}",
      authorSocials: "{}",
      isFeatured: false,
      trashedAt: null,
      wordCount: countWords("Old Co made our week easier."),
    });
    expect(listConsentEvents(ola.id).map((e) => e.type)).toEqual(["granted", "imported"]);
    // Its history starts with the import.
    expect(listHistory(ola.id)).toMatchObject([{ actor: "import", action: "created" }]);
    const request = one(getDb().select().from(requests).where(eq(requests.projectId, copy.id)).all());
    expect(request).toMatchObject({ formId: form.id, testimonialId: ola.id, nextReminderAt: null });
    expect(listPublicTestimonials(copy.id).map((t) => t.name)).toEqual(["Ola"]);
  });

  it("imports archives written between M1 builds, with hidden or trashed in status itself", async () => {
    const archive = structuredClone(LEGACY_ARCHIVE) as unknown as { testimonials: Record<string, unknown>[] };
    archive.testimonials[0].status = "hidden";
    archive.testimonials[1].status = "trashed";
    const file = path.join(ctx.dir, "between.zip");
    await writeZip(file, [{ name: "plaudit.json", data: JSON.stringify(archive) }]);
    const { copy } = await importAsNew(file);
    const items = listTestimonials(copy.id);
    expect(items.find((t) => t.authorName === "Ola")).toMatchObject({ status: "hidden", approvedBy: null });
    expect(items.find((t) => t.authorName === "Api Person")).toMatchObject({ status: "trashed", trashedAt: expect.any(Date) });
    expect(listPublicTestimonials(copy.id)).toEqual([]);
  });
});

// ------------------------------------------------------------ a full project

/** A project using every Phase 1 table, with files for every kind of media. */
async function seedEverything() {
  const project = createProject({ name: "Acme", slug: "acme" });
  const projectId = project.id;
  const db = getDb();
  updateProject(projectId, {
    website: "https://acme.example",
    businessType: "saas",
    brand: { colors: { primary: "#112233" }, fonts: { heading: "inter" } },
    autoApprove: true,
    autoApproveMinRating: 5,
  });
  const [projectLogo, formLogo, avatar, companyLogo, image, wallLogo, wallCover] = await Promise.all(Array.from({ length: 7 }, savePng));
  const answerVideo = await saveFile(SAMPLE_WEBM, "video/webm", "video");
  db.update(projects).set({ logoKey: projectLogo.key }).where(eq(projects.id, projectId)).run();

  const stories = createForm(projectId, { name: "Customer stories" });
  updateForm(stories.id, {
    logoKey: formLogo.key,
    settings: { ...parseFormRow(stories).settings, autoTags: ["story"], autoApprove: { mode: "all", minRating: 3, includeVideo: false, since: null } },
  });
  changeFormSlug(stories.id, "stories"); // the old "customer-stories" link keeps working

  const customer = upsertCustomer(projectId, { email: "Ada@Example.com", name: "Ada", company: "Acme", avatarKey: avatar.key, socials: { x: "@ada" } })!;
  const ada = createTestimonial(projectId, {
    name: "Ada",
    email: "ada@example.com",
    text: "Plaudit saved us hours every week.",
    rating: 5,
    formId: stories.id,
    customerId: customer.id,
    headline: "Hours back",
    platform: "website",
    sourceUrl: "https://acme.example/reviews/1",
    sourceReviewId: "rev-1",
    sourceDate: new Date("2026-03-14T00:00:00.000Z"),
    datePrecision: "month",
    language: "en",
    authorWebsite: "https://ada.example",
    authorPhone: "+44 20 7946 0000",
    authorSocials: { linkedin: "ada" },
    companyLogoKey: companyLogo.key,
    primaryQuestion: "What changed for you?",
    customFields: { plan: "Enterprise", seats: 40 },
    hiddenFields: { utm_source: "newsletter" },
  });
  const [q2, q3] = db.transaction((tx) =>
    insertAnswers(tx, ada.id, [
      { questionKey: "q2", questionTitle: "What would you tell a friend?", position: 1, text: "Just try it." },
      { questionKey: "q3", questionTitle: "Show us", position: 2, videoKey: answerVideo.key, videoMime: answerVideo.mime, videoOriginalKey: answerVideo.key },
    ]),
  );
  db.insert(testimonialImages).values({ id: crypto.randomUUID(), testimonialId: ada.id, questionKey: "q2", key: image.key, alt: "Our dashboard", position: 0 }).run();
  updateTestimonial(ada.id, { status: "approved", tags: ["pricing"] }, { by: ADMIN_EMAIL });
  setHighlights(
    ada.id,
    [
      { answerId: null, start: 0, end: 7 },
      { answerId: q2.id, start: 0, end: 4 },
    ],
    { by: ADMIN_EMAIL },
  );
  db.insert(feedback)
    .values({ id: crypto.randomUUID(), projectId, formId: stories.id, customerId: customer.id, testimonialId: ada.id, rating: 4, text: "Exports could be faster.", authorName: "Ada" })
    .run();

  const hal = createTestimonial(projectId, { name: "Hal", text: "Internal only, please." });
  updateTestimonial(hal.id, { status: "hidden" });
  const tia = createTestimonial(projectId, { name: "Tia", text: "Old news now." });
  updateTestimonial(tia.id, { status: "approved" });
  trashTestimonial(tia.id);

  const { created } = createRequests(getProjectById(projectId)!, [{ email: "bo@example.com", name: "Bo" }], { send: false });
  db.update(requests).set({ formId: stories.id }).where(eq(requests.id, created[0].id)).run();

  const widgetId = "w_abcdefgh1234";
  db.insert(widgets)
    .values({
      id: widgetId,
      projectId,
      name: "Homepage marquee",
      layout: "marquee",
      selectionMode: "manual",
      manualIds: JSON.stringify([ada.id, tia.id, "deleted-before-export"]),
      pinnedIds: JSON.stringify([ada.id]),
      filters: JSON.stringify({ minRating: 4, include: [ada.id], formId: stories.id }),
      design: JSON.stringify({ theme: "dark", accent: "#112233" }),
      connectedFormId: stories.id,
      placement: "homepage",
    })
    .run();
  const wallId = crypto.randomUUID();
  db.insert(walls)
    .values({
      id: wallId,
      projectId,
      slug: "love",
      name: "Love",
      published: true,
      isMain: true,
      config: JSON.stringify({ hero: { title: "Loved by teams" }, cta: { formId: stories.id, label: "Add yours" } }),
      logoKey: wallLogo.key,
      coverKey: wallCover.key,
      featuredTestimonialId: ada.id,
      connectedFormId: stories.id,
    })
    .run();
  const snippetId = "s_abcdefgh1234";
  db.insert(seoSnippets)
    .values({ id: snippetId, projectId, name: "Product page", schemaType: "SoftwareApplication", scope: JSON.stringify({ minRating: 4 }), item: JSON.stringify({ name: "Acme", url: "https://acme.example" }) })
    .run();
  db.insert(slugRedirects).values({ id: crypto.randomUUID(), kind: "wall", scope: projectId, projectId, wallId, oldSlug: "wall-of-love" }).run();
  db.insert(slugRedirects).values({ id: crypto.randomUUID(), kind: "project", scope: "", projectId, oldSlug: "acme-old" }).run();

  return {
    project: getProjectById(projectId)!,
    ids: { ada: ada.id, hal: hal.id, tia: tia.id, stories: stories.id, q2: q2.id, q3: q3.id, widgetId, wallId, snippetId },
    keys: { projectLogo, formLogo, avatar, companyLogo, image, wallLogo, wallCover, answerVideo },
  };
}

/** Exports from this server, then points the app at a fresh one (another instance) to import there. */
async function exportAndMove(project: Project) {
  const file = path.join(ctx.dir, "acme.zip");
  await exportTo(project, file);
  const from = ctx;
  ctx = useTempDataDir();
  registerJobs();
  const moved = path.join(ctx.dir, "acme.zip");
  fs.copyFileSync(file, moved);
  from.cleanup();
  return moved;
}

describe("new archives", () => {
  it("a new archive round-trips forms, answers, highlights, widgets, walls and statusV2: hidden", async () => {
    const { project, ids, keys } = await seedEverything();
    const historyBefore = listHistory(ids.ada).map((h) => [h.actor, h.actorEmail, h.action]);
    const defaultBefore = parseFormRow(getDefaultForm(project.id));

    const file = await exportAndMove(project);
    const manifest = await readJson(file);
    // Every kind of file is in the zip, once.
    const zip = await openZip(file);
    const media = [...zip.entries.keys()].filter((n) => n.startsWith("media/")).sort();
    expect(media).toEqual(Object.values(keys).map((k) => `media/${k.key}`).sort());
    expect(manifest.testimonials.find((t: { id: string }) => t.id === ids.hal)).toMatchObject({ status: "rejected", statusV2: "hidden" });
    expect(manifest.testimonials.find((t: { id: string }) => t.id === ids.tia)).toMatchObject({
      status: "rejected",
      statusV2: "trashed",
      statusBeforeTrash: "approved",
    });

    const before = Date.now();
    const { copy, counts } = await importAsNew(file);
    expect(counts).toMatchObject({ testimonials: 3, requests: 1, forms: 2, customers: 1, feedback: 1, widgets: 1, walls: 1, seoSnippets: 1, media: 8 });

    // The project, its brand kit and logo.
    expect(copy).toMatchObject({ slug: "acme", name: "Acme", website: "https://acme.example", businessType: "saas", autoApprove: true, autoApproveMinRating: 5 });
    expect(JSON.parse(copy.brand)).toMatchObject({ colors: { primary: "#112233" }, fonts: { heading: "inter" } });
    expect(onDisk(copy.logoKey)).toBe(true);
    expect(isMediaPublic(copy.logoKey!)).toBe(true);

    // Forms: the default one replaces the one the project was made with, and the mirror follows it.
    const [def, stories] = listForms(copy.id);
    expect(def).toMatchObject({ isDefault: true, layout: "classic", slug: "default" });
    const defCfg = parseFormRow(def);
    expect(defCfg.pages).toEqual(defaultBefore.pages);
    expect(defCfg.settings.autoApprove).toMatchObject({ mode: "rating", minRating: 5 });
    // Rules apply from the import on, never to what came with it.
    expect(defCfg.settings.autoApprove.since!.getTime()).toBeGreaterThanOrEqual(before);
    expect(copy.autoApproveSince!.getTime()).toBe(defCfg.settings.autoApprove.since!.getTime());
    expect(stories).toMatchObject({ isDefault: false, layout: "steps", slug: "stories", name: "Customer stories", stats: { submissions: 1 } });
    expect(parseFormRow(stories).settings).toMatchObject({ autoTags: ["story"], autoApprove: { mode: "all", minRating: 3 } });
    expect(parseFormRow(stories).settings.autoApprove.since!.getTime()).toBeGreaterThanOrEqual(before);
    expect(onDisk(stories.logoKey)).toBe(true);
    expect(getFormBySlug(copy.id, "customer-stories")).toMatchObject({ form: { id: stories.id }, redirectedFrom: "customer-stories" });

    // The testimonial with everything.
    const items = listTestimonials(copy.id);
    const ada = items.find((t) => t.authorName === "Ada")!;
    const customer = one(getDb().select().from(customers).where(eq(customers.projectId, copy.id)).all());
    expect(customer).toMatchObject({ email: "ada@example.com", name: "Ada", company: "Acme" });
    expect(JSON.parse(customer.socials)).toEqual({ x: "@ada" });
    expect(onDisk(customer.avatarKey)).toBe(true);
    expect(ada).toMatchObject({
      status: "approved",
      approvedBy: "owner",
      tags: ["pricing"],
      formId: stories.id,
      customerId: customer.id,
      headline: "Hours back",
      platform: "website",
      sourceUrl: "https://acme.example/reviews/1",
      sourceReviewId: "rev-1",
      sourceDate: new Date("2026-03-14T00:00:00.000Z"),
      datePrecision: "month",
      language: "en",
      authorWebsite: "https://ada.example",
      authorPhone: "+44 20 7946 0000",
      primaryQuestion: "What changed for you?",
      consentPublic: true,
      wordCount: countWords("Plaudit saved us hours every week.") + countWords("Just try it."),
    });
    expect(JSON.parse(ada.customFields)).toEqual({ plan: "Enterprise", seats: 40 });
    expect(JSON.parse(ada.hiddenFields)).toEqual({ utm_source: "newsletter" });
    expect(JSON.parse(ada.authorSocials)).toEqual({ linkedin: "ada" });
    expect(onDisk(ada.companyLogoKey)).toBe(true);
    expect(ada.companyLogoKey).not.toBe(keys.companyLogo.key); // every file gets a new key here

    const [q2, q3] = listAnswers(ada.id);
    expect(q2).toMatchObject({ questionKey: "q2", questionTitle: "What would you tell a friend?", position: 1, text: "Just try it.", videoKey: null });
    expect(q3).toMatchObject({ questionKey: "q3", position: 2, videoMime: "video/webm", mediaStatus: "none" });
    expect(onDisk(q3.videoKey)).toBe(true);
    expect(fs.readFileSync(path.join(env.uploadsDir, q3.videoOriginalKey!)).equals(fs.readFileSync(SAMPLE_WEBM))).toBe(true);
    // Answer videos stay owner-only (D13).
    expect(isMediaPublic(q3.videoKey!)).toBe(false);
    const image = one(getDb().select().from(testimonialImages).where(eq(testimonialImages.testimonialId, ada.id)).all());
    expect(image).toMatchObject({ questionKey: "q2", alt: "Our dashboard", position: 0 });
    expect(onDisk(image.key) && isMediaPublic(image.key)).toBe(true);
    expect(listHighlights(ada.id).map((h) => [h.answerId, h.start, h.end, h.phrase])).toEqual([
      [null, 0, 7, "Plaudit"],
      [q2.id, 0, 4, "Just"],
    ]);
    expect(listHistory(ada.id).map((h) => [h.actor, h.actorEmail, h.action])).toEqual(historyBefore);
    expect(one(getDb().select().from(feedback).where(eq(feedback.projectId, copy.id)).all())).toMatchObject({
      formId: stories.id,
      customerId: customer.id,
      testimonialId: ada.id,
      rating: 4,
      text: "Exports could be faster.",
    });
    expect(one(getDb().select().from(requests).where(eq(requests.projectId, copy.id)).all())).toMatchObject({ email: "bo@example.com", formId: stories.id });

    // Hidden and trashed come back as they were; the trash still restores to approved.
    const hal = items.find((t) => t.authorName === "Hal")!;
    expect(hal).toMatchObject({ status: "hidden", formId: null });
    const tia = items.find((t) => t.authorName === "Tia")!;
    expect(tia).toMatchObject({ status: "trashed", statusBeforeTrash: "approved", approvedBy: "owner", trashedAt: expect.any(Date) });
    expect(restoreTestimonial(tia.id)).toMatchObject({ status: "approved", approvedBy: "owner" });
    expect(listPublicTestimonials(copy.id).map((t) => t.name).sort()).toEqual(["Ada", "Tia"]);

    // The widget, wall and snippet point at the new rows.
    const widget = one(getDb().select().from(widgets).where(eq(widgets.projectId, copy.id)).all());
    expect(widget).toMatchObject({ id: ids.widgetId, name: "Homepage marquee", layout: "marquee", selectionMode: "manual", connectedFormId: stories.id, placement: "homepage" });
    expect(JSON.parse(widget.manualIds)).toEqual([ada.id, tia.id]); // the id of a row that wasn't exported is dropped
    expect(JSON.parse(widget.pinnedIds)).toEqual([ada.id]);
    expect(JSON.parse(widget.filters)).toEqual({ minRating: 4, include: [ada.id], formId: stories.id });
    expect(JSON.parse(widget.design)).toEqual({ theme: "dark", accent: "#112233" });
    const wall = one(getDb().select().from(walls).where(eq(walls.projectId, copy.id)).all());
    expect(wall).toMatchObject({ slug: "love", name: "Love", published: true, isMain: true, featuredTestimonialId: ada.id, connectedFormId: stories.id });
    expect(wall.id).not.toBe(ids.wallId);
    expect(JSON.parse(wall.config)).toEqual({ hero: { title: "Loved by teams" }, cta: { formId: stories.id, label: "Add yours" } });
    expect(onDisk(wall.logoKey) && onDisk(wall.coverKey)).toBe(true);
    expect(isMediaPublic(wall.coverKey!)).toBe(true); // published
    const snippet = one(getDb().select().from(seoSnippets).where(eq(seoSnippets.projectId, copy.id)).all());
    expect(snippet).toMatchObject({ id: ids.snippetId, name: "Product page", schemaType: "SoftwareApplication" });
    expect(JSON.parse(snippet.item)).toEqual({ name: "Acme", url: "https://acme.example" });

    // Old links of the project and its wall keep working on the new server.
    const links = getDb().select().from(slugRedirects).where(eq(slugRedirects.projectId, copy.id)).all();
    expect(links.map((r) => [r.kind, r.oldSlug, r.scope]).sort()).toEqual([
      ["form", "customer-stories", copy.id],
      ["project", "acme-old", ""],
      ["wall", "wall-of-love", copy.id],
    ]);
    expect(links.find((r) => r.kind === "wall")!.wallId).toBe(wall.id);
    // The temporary files are gone.
    expect(fs.readdirSync(env.tmpDir).filter((f) => f.startsWith("import-"))).toEqual([]);
  });

  it("widget ids are kept when they are free, and new ones made when they aren't", async () => {
    const { project, ids } = await seedEverything();
    const file = path.join(ctx.dir, "acme.zip");
    await exportTo(project, file);

    // A copy beside the original on the same server: those ids are taken.
    const { copy: here } = await importAsNew(file);
    const hereWidget = one(getDb().select().from(widgets).where(eq(widgets.projectId, here.id)).all());
    const hereSnippet = one(getDb().select().from(seoSnippets).where(eq(seoSnippets.projectId, here.id)).all());
    expect(hereWidget.id).toMatch(/^w_[a-z0-9]{12}$/);
    expect(hereWidget.id).not.toBe(ids.widgetId);
    expect(hereSnippet.id).toMatch(/^s_[a-z0-9]{12}$/);
    expect(hereSnippet.id).not.toBe(ids.snippetId);
    expect(here).toMatchObject({ slug: "acme-2", name: "Acme (imported)" });
    // The original keeps its old links; the copy doesn't take them over.
    expect(getDb().select().from(slugRedirects).where(and(eq(slugRedirects.kind, "project"), eq(slugRedirects.oldSlug, "acme-old"))).get()).toMatchObject({
      projectId: project.id,
    });

    // On another server, they're free, so embeds and snippets on other sites keep working after a move.
    const moved = await exportAndMove(project);
    const { copy: there } = await importAsNew(moved);
    expect(one(getDb().select().from(widgets).where(eq(widgets.projectId, there.id)).all()).id).toBe(ids.widgetId);
    expect(one(getDb().select().from(seoSnippets).where(eq(seoSnippets.projectId, there.id)).all()).id).toBe(ids.snippetId);
  });

  it("an archive with hidden rows still validates against the legacy enum", async () => {
    const { project, ids } = await seedEverything();
    // Through JSON, as it travels in plaudit.json.
    const manifest = JSON.parse(JSON.stringify(buildManifest(project)));
    const legacy = legacyManifestSchema.safeParse(manifest);
    expect(legacy.success).toBe(true);
    const statuses = new Map(legacy.data!.testimonials.map((t) => [t.id, t.status]));
    // An older server imports them unpublished: neither ever becomes public there.
    expect(statuses.get(ids.hal)).toBe("rejected");
    expect(statuses.get(ids.tia)).toBe("rejected");
    expect(statuses.get(ids.ada)).toBe("approved");
    for (const t of manifest.testimonials) expect(LEGACY_STATUSES).toContain(t.status);
    // Its project settings are the default form's, so that server's own default form gets them.
    expect(legacy.data!.project).toMatchObject({ autoApprove: true, autoApproveMinRating: 5 });
  });
});

// ------------------------------------------------------------ other versions

describe("archives from elsewhere", () => {
  async function smallManifest() {
    const project = createProject({ name: "Beta", slug: "beta" });
    const t = createTestimonial(project.id, { name: "Ben", text: "Plaudit is lovely to use.", rating: 5 });
    updateTestimonial(t.id, { status: "approved" });
    const w = createTestimonial(project.id, { name: "Wes", text: "Withdrawn later." });
    getDb().insert(widgets).values({ id: "w_beta00000001", projectId: project.id, name: "Grid" }).run();
    getDb().insert(walls).values({ id: crypto.randomUUID(), projectId: project.id, slug: "wall", name: "Wall" }).run();
    return { project, manifest: JSON.parse(JSON.stringify(buildManifest(project))), ids: { ben: t.id, wes: w.id } };
  }

  async function importManifest(manifest: unknown) {
    const file = path.join(ctx.dir, `m-${crypto.randomUUID()}.zip`);
    await writeZip(file, [{ name: "plaudit.json", data: JSON.stringify(manifest) }]);
    return importAsNew(file);
  }

  it("imports what it understands from a newer version's archive", async () => {
    const { manifest, ids } = await smallManifest();
    manifest.campaigns = [{ id: "c-1", name: "Spring" }];
    const ben = manifest.testimonials.find((t: { id: string }) => t.id === ids.ben);
    ben.sentiment = "positive";
    ben.datePrecision = "week";
    ben.history.push(
      { actor: "robot", actorEmail: null, action: "summarised", diff: {}, at: new Date().toISOString() },
      { actor: "robot", actorEmail: null, action: "edited", diff: { text: ["a", "b"] }, at: new Date().toISOString() },
    );
    const wes = manifest.testimonials.find((t: { id: string }) => t.id === ids.wes);
    wes.status = "rejected";
    wes.statusV2 = "archived"; // a status this version doesn't have: the legacy one is used
    manifest.widgets[0].layout = "spiral";
    manifest.widgets[0].name = "x".repeat(500);
    manifest.walls[0].theme = "neon";
    manifest.forms[0].pages.splice(1, 0, { type: "poll", question: "Which plan?" });
    manifest.forms[0].settings.someNewRule = { on: true };
    manifest.seoSnippets = [{ id: "s_beta00000001", name: "Event page", schemaType: "Event", scope: {}, item: {} }];

    const { copy } = await importManifest(manifest);
    const items = listTestimonials(copy.id);
    const imported = items.find((t) => t.authorName === "Ben")!;
    expect(imported).toMatchObject({ status: "approved", datePrecision: "day" });
    expect(listHistory(imported.id).map((h) => [h.actor, h.action])).toEqual([
      ["customer", "created"],
      ["owner", "status"],
      ["system", "edited"],
    ]);
    expect(items.find((t) => t.authorName === "Wes")).toMatchObject({ status: "rejected" });
    expect(one(getDb().select().from(widgets).where(eq(widgets.projectId, copy.id)).all())).toMatchObject({ layout: "grid", name: "x".repeat(120) });
    expect(one(getDb().select().from(walls).where(eq(walls.projectId, copy.id)).all())).toMatchObject({ theme: "neon" });
    expect(one(getDb().select().from(seoSnippets).where(eq(seoSnippets.projectId, copy.id)).all())).toMatchObject({ schemaType: "Product" });
    const pages = parseFormRow(getDefaultForm(copy.id)).pages.map((p) => p.type);
    expect(pages).not.toContain("poll");
    expect(pages).toContain("question");
  });

  it("a hand-edited archive can't publish what the author didn't agree to, or plant links", async () => {
    const { manifest, ids } = await smallManifest();
    const ben = manifest.testimonials.find((t: { id: string }) => t.id === ids.ben);
    ben.consentPublic = false; // "keep private", yet marked approved
    ben.sourceUrl = "javascript:alert(1)";
    ben.author.website = "ftp://example.com/x";
    ben.highlights = [
      { answerId: null, start: 5, end: 12, phrase: "Plaudit", createdAt: null }, // in the wrong place
      { answerId: null, start: 0, end: 4, phrase: "nope", createdAt: null }, // not in the text at all
      { answerId: "no-such-answer", start: 0, end: 4, phrase: "Plau", createdAt: null },
    ];
    const wes = manifest.testimonials.find((t: { id: string }) => t.id === ids.wes);
    wes.consent.withdrawnAt = new Date().toISOString();
    wes.statusV2 = "hidden";
    manifest.customers = [
      { id: "c-1", email: "Sam@Example.com", name: "Sam" },
      { id: "c-2", email: "sam@example.com", name: "Samuel" },
    ];
    ben.customerId = "c-2";
    manifest.widgets[0].id = "w_short";
    manifest.redirects = [
      { kind: "project", oldSlug: "beta", formId: null, wallId: null }, // a live project here has it
      { kind: "project", oldSlug: "Not a slug!", formId: null, wallId: null },
      { kind: "wall", oldSlug: "old-wall", formId: null, wallId: "missing" },
    ];

    const { copy } = await importManifest(manifest);
    const items = listTestimonials(copy.id);
    const imported = items.find((t) => t.authorName === "Ben")!;
    expect(imported).toMatchObject({ status: "hidden", consentPublic: false, sourceUrl: null, authorWebsite: null, approvedBy: null });
    expect(listPublicTestimonials(copy.id)).toEqual([]);
    expect(listHighlights(imported.id).map((h) => [h.start, h.end, h.phrase])).toEqual([[0, 7, "Plaudit"]]);
    expect(items.find((t) => t.authorName === "Wes")).toMatchObject({ status: "rejected", withdrawnAt: expect.any(Date) });
    const customer = one(getDb().select().from(customers).where(eq(customers.projectId, copy.id)).all());
    expect(customer).toMatchObject({ email: "sam@example.com", name: "Sam" });
    expect(imported.customerId).toBe(customer.id);
    expect(one(getDb().select().from(widgets).where(eq(widgets.projectId, copy.id)).all()).id).toMatch(/^w_[a-z0-9]{12}$/);
    expect(getDb().select().from(slugRedirects).where(eq(slugRedirects.projectId, copy.id)).all()).toEqual([]);
    // Approving it is refused, as for any private testimonial.
    expect(() => updateTestimonial(imported.id, { status: "approved" })).toThrow(/keep this testimonial private/);
  });

  it("imports the rest when the Phase 1 parts are missing or malformed", async () => {
    const { manifest } = await smallManifest();
    manifest.forms = "not a list";
    manifest.widgets = [{ name: "no id" }, manifest.widgets[0]];
    manifest.walls = null;
    delete manifest.customers;
    const { copy, counts } = await importManifest(manifest);
    expect(counts).toMatchObject({ testimonials: 2, forms: 0, widgets: 1, walls: 0 });
    // Without forms in the archive, the project's own default form stays.
    expect(one(listForms(copy.id))).toMatchObject({ isDefault: true, layout: "classic" });
  });
});

// ------------------------------------------------------------ S3

const S3_KEYS = { accessKeyId: "PLAUDITTESTKEY", secretAccessKey: "plaudit-test-secret-0123456789" };
const S3_ENV = {
  STORAGE_DRIVER: "s3",
  S3_ENDPOINT: "http://minio.test:9000",
  S3_REGION: "eu-west-2",
  S3_BUCKET: "plaudit-media",
  S3_ACCESS_KEY_ID: S3_KEYS.accessKeyId,
  S3_SECRET_ACCESS_KEY: S3_KEYS.secretAccessKey,
  S3_FORCE_PATH_STYLE: "true",
  S3_PREFIX: "/media/",
};

describe("TEAM-05 STORAGE_DRIVER=s3", () => {
  let fake: ReturnType<typeof createFakeS3>;
  beforeEach(() => {
    fake = createFakeS3({ bucket: S3_ENV.S3_BUCKET, region: S3_ENV.S3_REGION, ...S3_KEYS });
    Object.assign(process.env, S3_ENV);
    resetStorage({ fetch: fake.fetch });
  });
  afterEach(() => {
    for (const k of Object.keys(S3_ENV)) delete process.env[k];
    resetStorage();
  });

  it("exports files read from the bucket and imports them back into it", async () => {
    const project = createProject({ name: "Cloud", slug: "cloud" });
    const video = await saveFile(SAMPLE_WEBM, "video/webm", "video");
    const logo = await savePng();
    expect(fake.objects.has(`media/${video.key}`) && !onDisk(video.key)).toBe(true);
    createTestimonial(project.id, { name: "Vi", videoKey: video.key, videoMime: video.mime });
    getDb().update(projects).set({ logoKey: logo.key }).where(eq(projects.id, project.id)).run();

    const file = path.join(ctx.dir, "cloud.zip");
    await exportTo(getProjectById(project.id)!, file);
    const zip = await openZip(file);
    const out = path.join(ctx.dir, "clip.webm");
    await extractEntry(zip, zip.entries.get(`media/${video.key}`)!, out, 1e8);
    expect(fs.readFileSync(out).equals(fs.readFileSync(SAMPLE_WEBM))).toBe(true);
    expect(zip.entries.has(`media/${logo.key}`)).toBe(true);
    // The temporary copies made to read them are gone.
    expect(fs.readdirSync(env.tmpDir).filter((f) => f.startsWith("s3-"))).toEqual([]);

    const { copy } = await importAsNew(file);
    const vi = getTestimonial(listTestimonials(copy.id)[0].id)!;
    expect(fake.objects.get(`media/${vi.videoOriginalKey}`)!.body.equals(fs.readFileSync(SAMPLE_WEBM))).toBe(true);
    expect(fake.objects.has(`media/${copy.logoKey}`)).toBe(true);
    expect(onDisk(vi.videoOriginalKey) || onDisk(copy.logoKey)).toBe(false);
  });
});
