import crypto from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Project, Testimonial, TestimonialStatus } from "@/db/schema";
import { deleteObject, mediaUrl, MIME_BY_EXT } from "./storage";

const { projects, testimonials, tags, testimonialTags } = schema;

export const DEFAULT_PROMPT = "How has our product helped you? We'd love to hear your story.";
export const DEFAULT_THANK_YOU = "Thank you! Your testimonial has been received.";
export const DEFAULT_QUESTIONS = [
  "What were things like before?",
  "What changed for you?",
  "Who would you recommend it to?",
];

/** The project's prompts, one per line, falling back to the defaults. */
export function projectQuestions(project: Pick<Project, "questions">) {
  const lines = project.questions
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines : DEFAULT_QUESTIONS;
}

// ---------------------------------------------------------------- projects

export function listProjects() {
  return getDb().select().from(projects).orderBy(desc(projects.createdAt)).all();
}

export function getProjectBySlug(slug: string) {
  return getDb().select().from(projects).where(eq(projects.slug, slug)).get() ?? null;
}

export function getProjectById(id: string) {
  return getDb().select().from(projects).where(eq(projects.id, id)).get() ?? null;
}

export function createProject(input: {
  name: string;
  slug: string;
  prompt?: string;
  thankYouMessage?: string;
  accentColor?: string;
  allowVideo?: boolean;
  allowText?: boolean;
  questions?: string;
  maxVideoSeconds?: number;
}): Project {
  return getDb()
    .insert(projects)
    .values({
      id: crypto.randomUUID(),
      name: input.name,
      slug: input.slug,
      prompt: input.prompt ?? DEFAULT_PROMPT,
      thankYouMessage: input.thankYouMessage ?? DEFAULT_THANK_YOU,
      accentColor: input.accentColor,
      allowVideo: input.allowVideo,
      allowText: input.allowText,
      questions: input.questions ?? DEFAULT_QUESTIONS.join("\n"),
      maxVideoSeconds: input.maxVideoSeconds,
    })
    .returning()
    .get();
}

export function updateProject(
  id: string,
  patch: Partial<
    Pick<
      Project,
      "name" | "prompt" | "thankYouMessage" | "accentColor" | "allowVideo" | "allowText" | "questions" | "maxVideoSeconds"
    >
  >,
) {
  return getDb().update(projects).set(patch).where(eq(projects.id, id)).returning().get() ?? null;
}

// ------------------------------------------------------------ testimonials

export interface NewTestimonial {
  name: string;
  email?: string;
  title?: string;
  company?: string;
  rating?: number;
  text?: string;
  avatarKey?: string;
  videoKey?: string;
  videoMime?: string;
}

export function createTestimonial(projectId: string, input: NewTestimonial): Testimonial {
  const now = new Date();
  return getDb()
    .insert(testimonials)
    .values({
      id: crypto.randomUUID(),
      projectId,
      status: "pending",
      authorName: input.name,
      authorEmail: input.email ?? null,
      authorTitle: input.title ?? null,
      authorCompany: input.company ?? null,
      rating: input.rating ?? null,
      text: input.text ?? null,
      avatarKey: input.avatarKey ?? null,
      videoKey: input.videoKey ?? null,
      videoMime: input.videoMime ?? null,
      videoOriginalKey: input.videoKey ?? null,
      consentAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export type TestimonialWithTags = Testimonial & { tags: string[] };

function attachTags(rows: Testimonial[]): TestimonialWithTags[] {
  if (rows.length === 0) return [];
  const links = getDb()
    .select({ testimonialId: testimonialTags.testimonialId, name: tags.name })
    .from(testimonialTags)
    .innerJoin(tags, eq(tags.id, testimonialTags.tagId))
    .where(
      inArray(
        testimonialTags.testimonialId,
        rows.map((r) => r.id),
      ),
    )
    .all();
  const byId = new Map<string, string[]>();
  for (const l of links) {
    byId.set(l.testimonialId, [...(byId.get(l.testimonialId) ?? []), l.name]);
  }
  return rows.map((r) => ({ ...r, tags: (byId.get(r.id) ?? []).sort() }));
}

export function listTestimonials(
  projectId: string,
  opts: { status?: TestimonialStatus; tag?: string; limit?: number } = {},
): TestimonialWithTags[] {
  const db = getDb();
  const conditions = [eq(testimonials.projectId, projectId)];
  if (opts.status) conditions.push(eq(testimonials.status, opts.status));
  if (opts.tag) {
    const tagged = db
      .select({ id: testimonialTags.testimonialId })
      .from(testimonialTags)
      .innerJoin(tags, eq(tags.id, testimonialTags.tagId))
      .where(and(eq(tags.projectId, projectId), eq(tags.name, opts.tag)));
    conditions.push(inArray(testimonials.id, tagged));
  }
  let query = db
    .select()
    .from(testimonials)
    .where(and(...conditions))
    .orderBy(desc(testimonials.createdAt))
    .$dynamic();
  if (opts.limit) query = query.limit(opts.limit);
  return attachTags(query.all());
}

export function getTestimonial(id: string): TestimonialWithTags | null {
  const row = getDb().select().from(testimonials).where(eq(testimonials.id, id)).get();
  return row ? attachTags([row])[0] : null;
}

export function countByStatus(projectId: string) {
  const counts: Record<TestimonialStatus, number> = { pending: 0, approved: 0, rejected: 0 };
  const rows = getDb()
    .select({ status: testimonials.status })
    .from(testimonials)
    .where(eq(testimonials.projectId, projectId))
    .all();
  for (const r of rows) counts[r.status]++;
  return counts;
}

export function listProjectTags(projectId: string) {
  return getDb()
    .select({ name: tags.name })
    .from(tags)
    .where(eq(tags.projectId, projectId))
    .orderBy(tags.name)
    .all()
    .map((t) => t.name);
}

export function updateTestimonial(
  id: string,
  patch: {
    status?: TestimonialStatus;
    authorName?: string;
    authorTitle?: string | null;
    authorCompany?: string | null;
    text?: string | null;
    transcript?: string | null;
    captionsVtt?: string | null;
    tags?: string[];
  },
): TestimonialWithTags | null {
  const db = getDb();
  const existing = db.select().from(testimonials).where(eq(testimonials.id, id)).get();
  if (!existing) return null;
  const { tags: tagNames, ...fields } = patch;
  db.transaction((tx) => {
    tx.update(testimonials)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(testimonials.id, id))
      .run();
    if (tagNames) {
      const unique = [...new Set(tagNames.map((t) => t.trim().toLowerCase()).filter(Boolean))];
      tx.delete(testimonialTags).where(eq(testimonialTags.testimonialId, id)).run();
      for (const name of unique) {
        tx.insert(tags)
          .values({ id: crypto.randomUUID(), projectId: existing.projectId, name })
          .onConflictDoNothing()
          .run();
        const tag = tx
          .select()
          .from(tags)
          .where(and(eq(tags.projectId, existing.projectId), eq(tags.name, name)))
          .get()!;
        tx.insert(testimonialTags).values({ testimonialId: id, tagId: tag.id }).run();
      }
    }
  });
  return getTestimonial(id);
}

export async function deleteTestimonial(id: string) {
  const row = getDb().delete(testimonials).where(eq(testimonials.id, id)).returning().get();
  if (!row) return false;
  const keys = new Set([row.avatarKey, row.videoKey, row.videoOriginalKey, row.posterKey]);
  await Promise.all([...keys].map((k) => deleteObject(k)));
  return true;
}

// ---------------------------------------------------------------- public

/** The only shape that leaves the server for public pages and widgets. */
export interface PublicTestimonial {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  avatarUrl: string | null;
  rating: number | null;
  text: string | null;
  video: {
    url: string;
    mime: string;
    poster: string | null;
    width: number | null;
    height: number | null;
    durationMs: number | null;
    /** Every playable copy, best first, for <source> elements. */
    sources: { url: string; type: string }[];
    /** WebVTT captions, if there are any. */
    captionsUrl: string | null;
    transcript: string | null;
  } | null;
  tags: string[];
  createdAt: string;
}

// Naming the codecs lets a browser without H.264 skip straight to the original.
const PROCESSED_TYPE = 'video/mp4; codecs="avc1.640028, mp4a.40.2"';

/** The converted MP4 first (plays everywhere), then the original upload as a fallback. */
export function videoSources(t: Testimonial) {
  if (!t.videoKey) return [];
  const sources = [
    { url: mediaUrl(t.videoKey)!, type: t.mediaStatus === "ready" ? PROCESSED_TYPE : (t.videoMime ?? "video/webm") },
  ];
  if (t.mediaStatus === "ready" && t.videoOriginalKey && t.videoOriginalKey !== t.videoKey) {
    const ext = t.videoOriginalKey.split(".").pop() ?? "";
    sources.push({ url: mediaUrl(t.videoOriginalKey)!, type: MIME_BY_EXT[ext] ?? "video/webm" });
  }
  return sources;
}

export function toPublic(t: TestimonialWithTags): PublicTestimonial {
  return {
    id: t.id,
    name: t.authorName,
    title: t.authorTitle,
    company: t.authorCompany,
    avatarUrl: mediaUrl(t.avatarKey),
    rating: t.rating,
    text: t.text,
    video: t.videoKey
      ? {
          url: mediaUrl(t.videoKey)!,
          mime: t.videoMime ?? "video/webm",
          poster: mediaUrl(t.posterKey),
          width: t.videoWidth,
          height: t.videoHeight,
          durationMs: t.videoDurationMs,
          sources: videoSources(t),
          captionsUrl: t.captionsVtt ? `/api/captions/${t.id}` : null,
          transcript: t.transcript,
        }
      : null,
    tags: t.tags,
    createdAt: t.createdAt.toISOString(),
  };
}

export function listPublicTestimonials(projectId: string, opts: { tag?: string; limit?: number } = {}) {
  return listTestimonials(projectId, { ...opts, status: "approved" }).map(toPublic);
}
