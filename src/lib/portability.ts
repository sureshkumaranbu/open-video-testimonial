import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Project } from "@/db/schema";
import { listConsentEvents, listConsentVersions, logConsentEvent } from "./consent";
import { toCsv } from "./csv";
import { env } from "./env";
import { PermanentJobError } from "./jobs";
import { queueVideoProcessing } from "./media";
import { listRequests } from "./requests";
import { deleteObject, resolveKey, saveFile, sniffMime } from "./storage";
import { createProject, getProjectBySlug, listTestimonials, type TestimonialWithTags } from "./testimonials";
import { extractEntry, openZip, readEntryText, ZipError, zipStream, type ZipSource } from "./zip";

/**
 * Export and import. An export is one .zip: `plaudit.json` (versioned, with
 * every testimonial, private fields, tags, consent history, requests and
 * project settings), `testimonials.csv` for spreadsheets, and `media/` with
 * every file. Importing that zip on any Plaudit instance recreates the
 * project, so moving servers or restoring a backup is one step.
 */
export const EXPORT_FORMAT = "plaudit-export";
export const IMPORT_JOB = "import.archive";
export const EXPORT_VERSION = 1;
const MANIFEST = "plaudit.json";

const mediaPath = (key: string | null) => (key ? `media/${key}` : null);

function exportTestimonial(t: TestimonialWithTags) {
  return {
    id: t.id,
    status: t.status,
    rating: t.rating,
    text: t.text,
    transcript: t.transcript,
    captionsVtt: t.captionsVtt,
    author: { name: t.authorName, email: t.authorEmail, title: t.authorTitle, company: t.authorCompany },
    tags: t.tags,
    source: t.source,
    requestId: t.requestId,
    consent: {
      at: t.consentAt.toISOString(),
      scopes: JSON.parse(t.consentScopes) as string[],
      editedAfterConsent: t.editedAfterConsent,
      withdrawnAt: t.withdrawnAt?.toISOString() ?? null,
      events: listConsentEvents(t.id).map((e) => ({
        type: e.type,
        actor: e.actor,
        versionId: e.versionId,
        text: e.text,
        textHash: e.textHash,
        scopes: e.scopes ? (JSON.parse(e.scopes) as string[]) : null,
        ipHash: e.ipHash,
        detail: e.detail,
        at: e.createdAt.toISOString(),
      })),
    },
    media: {
      video: mediaPath(t.videoKey),
      videoMime: t.videoMime,
      videoOriginal: t.videoOriginalKey !== t.videoKey ? mediaPath(t.videoOriginalKey) : null,
      poster: mediaPath(t.posterKey),
      avatar: mediaPath(t.avatarKey),
      durationMs: t.videoDurationMs,
      width: t.videoWidth,
      height: t.videoHeight,
    },
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function buildManifest(project: Project) {
  const items = listTestimonials(project.id);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    generator: "Plaudit",
    project: {
      slug: project.slug,
      name: project.name,
      prompt: project.prompt,
      thankYouMessage: project.thankYouMessage,
      accentColor: project.accentColor,
      allowVideo: project.allowVideo,
      allowText: project.allowText,
      questions: project.questions,
      maxVideoSeconds: project.maxVideoSeconds,
      consentText: project.consentText,
      inviteSubject: project.inviteSubject,
      inviteMessage: project.inviteMessage,
      reminderDays: project.reminderDays,
      thankYouEmail: project.thankYouEmail,
      createdAt: project.createdAt.toISOString(),
    },
    consentVersions: listConsentVersions(project.id).map((v) => ({
      id: v.id,
      version: v.version,
      text: v.text,
      hash: v.hash,
      createdAt: v.createdAt.toISOString(),
    })),
    testimonials: items.map(exportTestimonial),
    requests: listRequests(project.id).map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      company: r.company,
      status: r.status,
      sentAt: r.sentAt?.toISOString() ?? null,
      remindersSent: r.remindersSent,
      respondedAt: r.respondedAt?.toISOString() ?? null,
      unsubscribedAt: r.unsubscribedAt?.toISOString() ?? null,
      testimonialId: r.testimonialId,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export type Manifest = ReturnType<typeof buildManifest>;

export const CSV_HEADERS = [
  "id", "status", "name", "email", "title", "company", "rating", "text", "transcript", "tags",
  "video_url", "poster_url", "avatar_url", "source", "consent_scopes", "edited_after_consent",
  "withdrawn_at", "created_at",
];

export function testimonialsCsv(items: TestimonialWithTags[]) {
  const url = (key: string | null) => (key ? `${env.publicUrl}/api/media/${key}` : "");
  return toCsv(
    CSV_HEADERS,
    items.map((t) => [
      t.id, t.status, t.authorName, t.authorEmail, t.authorTitle, t.authorCompany, t.rating, t.text, t.transcript,
      t.tags.join(", "), url(t.videoKey), url(t.posterKey), url(t.avatarKey), t.source,
      (JSON.parse(t.consentScopes) as string[]).join(", "), t.editedAfterConsent ? "yes" : "no",
      t.withdrawnAt?.toISOString() ?? "", t.createdAt.toISOString(),
    ]),
  );
}

/** The export archive as a byte stream. */
export function exportZip(project: Project): ReadableStream<Uint8Array> {
  const manifest = buildManifest(project);
  const items = listTestimonials(project.id);
  async function* entries(): AsyncGenerator<ZipSource> {
    yield { name: MANIFEST, data: JSON.stringify(manifest, null, 2) };
    yield { name: "testimonials.csv", data: testimonialsCsv(items) };
    yield {
      name: "README.txt",
      data:
        `Plaudit export of "${project.name}" (${manifest.exportedAt}).\n\n` +
        "plaudit.json     everything, including private fields and consent history (format version 1)\n" +
        "testimonials.csv one row per testimonial, for spreadsheets\n" +
        "media/           videos, posters and photos\n\n" +
        "Import it on any Plaudit server from the admin home page (Import a project).\n" +
        "This file contains personal data (names, emails, consent records). Store it securely.\n",
    };
    const keys = new Set<string>();
    for (const t of items) {
      for (const k of [t.videoKey, t.videoOriginalKey, t.posterKey, t.avatarKey]) if (k) keys.add(k);
    }
    for (const key of keys) {
      const file = resolveKey(key);
      if (fs.existsSync(file)) yield { name: `media/${key}`, file };
    }
  }
  const iterator = zipStream(entries());
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}

// ------------------------------------------------------------------ import

const iso = z.iso.datetime({ offset: true });
const nullableIso = iso.nullable().optional();

const manifestSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
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
  }),
  consentVersions: z
    .array(z.object({ id: z.string(), version: z.number().int(), text: z.string(), hash: z.string(), createdAt: iso }))
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
      consent: z.object({
        at: iso,
        scopes: z.array(z.string()).default(["website"]),
        editedAfterConsent: z.boolean().default(false),
        withdrawnAt: nullableIso,
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
              at: iso,
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
      createdAt: iso,
      updatedAt: iso,
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
        sentAt: nullableIso,
        remindersSent: z.number().int().default(0),
        respondedAt: nullableIso,
        unsubscribedAt: nullableIso,
        testimonialId: z.string().nullable(),
        createdAt: iso,
      }),
    )
    .default([]),
});

export type ImportManifest = z.infer<typeof manifestSchema>;

export class ImportError extends Error {}

/** Reads and validates `plaudit.json` from an uploaded archive. */
export async function readManifest(zipPath: string) {
  let zip;
  try {
    zip = await openZip(zipPath);
  } catch (err) {
    throw new ImportError(err instanceof ZipError ? `${err.message}. Upload the .zip from a Plaudit export.` : String(err));
  }
  const entry = zip.entries.get(MANIFEST);
  if (!entry) throw new ImportError("This zip has no plaudit.json. Upload the .zip from a Plaudit export.");
  const text = await readEntryText(zip, entry, 200 * 1024 * 1024, `${zipPath}.manifest`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ImportError("plaudit.json isn't valid JSON");
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ImportError(`plaudit.json doesn't match export format ${EXPORT_VERSION}: ${issue.path.join(".")} ${issue.message}`);
  }
  return { zip, manifest: parsed.data };
}

/** A free slug based on `wanted` (acme, acme-2, acme-3…). */
export function freeSlug(wanted: string) {
  const base = wanted.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "").slice(0, 40) || "imported";
  if (!getProjectBySlug(base)) return base;
  for (let i = 2; ; i++) if (!getProjectBySlug(`${base}-${i}`)) return `${base}-${i}`;
}

/** Creates the (empty) target project for an import so the dashboard can link to it right away. */
export function createImportTarget(manifest: ImportManifest, opts: { slug?: string; name?: string }) {
  const p = manifest.project;
  return createProject({
    name: opts.name || p.name,
    slug: freeSlug(opts.slug || p.slug),
    prompt: p.prompt,
    thankYouMessage: p.thankYouMessage,
    accentColor: p.accentColor,
    allowVideo: p.allowVideo,
    allowText: p.allowText,
    questions: p.questions,
    maxVideoSeconds: p.maxVideoSeconds,
    consentText: p.consentText,
    inviteSubject: p.inviteSubject,
    inviteMessage: p.inviteMessage,
    reminderDays: p.reminderDays,
    thankYouEmail: p.thankYouEmail,
  });
}

/**
 * Fills `projectId` from the archive. Media is copied first; database rows
 * go in one transaction, so a failed import leaves no half-imported rows.
 * Request reminders are not resumed and no webhooks fire for imported data.
 */
export async function importArchive(zipPath: string, projectId: string) {
  const { zip, manifest } = await readManifest(zipPath);
  const db = getDb();
  const saved: string[] = [];
  const keyFor = new Map<string, { key: string; mime: string }>();
  await fs.promises.mkdir(env.tmpDir, { recursive: true });

  async function media(ref: string | null, kind: "video" | "image") {
    if (!ref) return null;
    if (keyFor.has(ref)) return keyFor.get(ref)!;
    const entry = zip.entries.get(ref);
    if (!entry) return null; // listed but not in the archive: skip it, keep the testimonial
    const tmp = path.join(env.tmpDir, `import-${crypto.randomUUID()}`);
    try {
      await extractEntry(zip, entry, tmp, kind === "video" ? env.maxVideoBytes : env.maxImageBytes);
      const head = Buffer.alloc(16);
      const fd = await fs.promises.open(tmp, "r");
      await fd.read(head, 0, 16, 0);
      await fd.close();
      const stored = await saveFile(tmp, sniffMime(head), kind, { move: true });
      saved.push(stored.key);
      keyFor.set(ref, stored);
      return stored;
    } finally {
      await fs.promises.rm(tmp, { force: true });
    }
  }

  try {
    const files = new Map<string, Awaited<ReturnType<typeof media>>[]>();
    for (const t of manifest.testimonials) {
      files.set(t.id, [
        await media(t.media.video, "video"),
        await media(t.media.videoOriginal, "video"),
        await media(t.media.poster, "image"),
        await media(t.media.avatar, "image"),
      ]);
    }

    const ids = new Map(manifest.testimonials.map((t) => [t.id, crypto.randomUUID()]));
    const versionIds = new Map(manifest.consentVersions.map((v) => [v.id, crypto.randomUUID()]));
    const requestIds = new Map(manifest.requests.map((r) => [r.id, crypto.randomUUID()]));
    const now = new Date();
    const date = (s: string | null | undefined) => (s ? new Date(s) : null);

    db.transaction((tx) => {
      for (const v of manifest.consentVersions) {
        tx.insert(schema.consentVersions)
          .values({ id: versionIds.get(v.id)!, projectId, version: v.version, text: v.text, hash: v.hash, createdAt: new Date(v.createdAt) })
          .run();
      }
      for (const t of manifest.testimonials) {
        const [video, original, poster, avatar] = files.get(t.id)!;
        const id = ids.get(t.id)!;
        const playable = video ?? original;
        tx.insert(schema.testimonials)
          .values({
            id,
            projectId,
            status: t.consent.withdrawnAt ? "rejected" : t.status,
            rating: t.rating,
            text: t.text,
            authorName: t.author.name,
            authorEmail: t.author.email,
            authorTitle: t.author.title,
            authorCompany: t.author.company,
            avatarKey: avatar?.key ?? null,
            videoKey: playable?.key ?? null,
            videoMime: playable?.mime ?? null,
            videoOriginalKey: (original ?? video)?.key ?? null,
            posterKey: poster?.key ?? null,
            videoDurationMs: t.media.durationMs,
            videoWidth: t.media.width,
            videoHeight: t.media.height,
            mediaStatus: !playable ? "none" : video && poster && video.mime === "video/mp4" && original ? "ready" : "none",
            transcript: t.transcript,
            captionsVtt: t.captionsVtt,
            transcriptStatus: t.transcript || t.captionsVtt ? "ready" : "none",
            consentAt: new Date(t.consent.at),
            consentScopes: JSON.stringify(t.consent.scopes),
            editedAfterConsent: t.consent.editedAfterConsent,
            withdrawnAt: date(t.consent.withdrawnAt),
            source: t.source,
            requestId: t.requestId ? (requestIds.get(t.requestId) ?? null) : null,
            createdAt: new Date(t.createdAt),
            updatedAt: new Date(t.updatedAt),
          })
          .run();
        for (const name of new Set(t.tags.map((x) => x.trim().toLowerCase()).filter(Boolean))) {
          tx.insert(schema.tags).values({ id: crypto.randomUUID(), projectId, name }).onConflictDoNothing().run();
          const tag = tx
            .select()
            .from(schema.tags)
            .where(and(eq(schema.tags.projectId, projectId), eq(schema.tags.name, name)))
            .get()!;
          tx.insert(schema.testimonialTags).values({ testimonialId: id, tagId: tag.id }).onConflictDoNothing().run();
        }
        for (const e of t.consent.events) {
          tx.insert(schema.consentEvents)
            .values({
              id: crypto.randomUUID(),
              testimonialId: id,
              type: e.type,
              actor: e.actor,
              versionId: e.versionId ? (versionIds.get(e.versionId) ?? null) : null,
              text: e.text,
              textHash: e.textHash,
              scopes: e.scopes ? JSON.stringify(e.scopes) : null,
              ipHash: e.ipHash,
              detail: e.detail,
              createdAt: new Date(e.at),
            })
            .run();
        }
      }
      for (const r of manifest.requests) {
        tx.insert(schema.requests)
          .values({
            id: requestIds.get(r.id)!,
            projectId,
            name: r.name,
            email: r.email,
            company: r.company,
            status: r.status,
            // Imported requests never send email by themselves.
            emailStatus: r.sentAt ? "sent" : "not_sent",
            sentAt: date(r.sentAt),
            remindersSent: r.remindersSent,
            nextReminderAt: null,
            respondedAt: date(r.respondedAt),
            unsubscribedAt: date(r.unsubscribedAt),
            testimonialId: r.testimonialId ? (ids.get(r.testimonialId) ?? null) : null,
            createdAt: new Date(r.createdAt),
          })
          .run();
      }
    });

    for (const t of manifest.testimonials) {
      logConsentEvent({
        testimonialId: ids.get(t.id)!,
        type: "imported",
        actor: "import",
        detail: `Imported from a Plaudit export made ${manifest.project.name ? `of "${manifest.project.name}" ` : ""}on ${now.toISOString().slice(0, 10)}`,
      });
    }
    // Convert anything that arrived without a processed MP4 and poster.
    for (const row of db.select().from(schema.testimonials).where(eq(schema.testimonials.projectId, projectId)).orderBy(asc(schema.testimonials.createdAt)).all()) {
      if (row.videoKey && row.mediaStatus === "none") await queueVideoProcessing(row.id);
    }
    return { testimonials: manifest.testimonials.length, requests: manifest.requests.length, media: saved.length };
  } catch (err) {
    await Promise.all(saved.map((k) => deleteObject(k)));
    if (err instanceof ZipError || err instanceof ImportError) throw new PermanentJobError(err.message);
    throw err;
  }
}
