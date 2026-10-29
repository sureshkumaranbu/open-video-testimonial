import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { MemberRole } from "@/db/schema";
import { featureOn } from "./features";

const { members, memberProjects, forms, widgets, walls, campaigns, testimonials, boosters, seoSnippets, requests, taskRuns, slugRedirects, answers, importSources, videoRenders, highlightReels, formVideos } =
  schema;

/**
 * TEAM-01: roles and per-project access (flag `team2`). Owner and admins
 * reach every project; an editor or viewer may be limited to some. With the
 * flag off everyone non-owner is an admin with every project, exactly as
 * before roles existed.
 */

export const LEVELS = ["viewer", "editor", "admin", "owner"] as const;
export type Level = (typeof LEVELS)[number];

export const teamOn = () => featureOn("team2");

/** Whether `role` may do what needs `level`. */
export function roleAtLeast(role: MemberRole, level: Level): boolean {
  return LEVELS.indexOf(role) >= LEVELS.indexOf(level);
}

/** Every project, or only these ids. */
export type ProjectAccess = { all: true } | { all: false; ids: Set<string> };
const ALL: ProjectAccess = { all: true };

/** The projects a signed-in person may open. */
export function projectAccessFor(email: string, role: MemberRole): ProjectAccess {
  if (!teamOn() || role === "owner" || role === "admin") return ALL;
  const db = getDb();
  const m = db.select({ id: members.id, allProjects: members.allProjects }).from(members).where(eq(members.email, email.trim().toLowerCase())).get();
  if (!m || m.allProjects) return ALL;
  const ids = db.select({ projectId: memberProjects.projectId }).from(memberProjects).where(eq(memberProjects.memberId, m.id)).all();
  return { all: false, ids: new Set(ids.map((r) => r.projectId)) };
}

export const canOpen = (access: ProjectAccess, projectId: string) => access.all || access.ids.has(projectId);

/** Keeps the projects (or rows with a projectId) that `access` allows. */
export function onlyOpen<T extends { id: string }>(access: ProjectAccess, projects: T[]): T[] {
  return access.all ? projects : projects.filter((p) => access.ids.has(p.id));
}

/** Sets which projects a member may open: null for every one. */
export function setMemberProjects(memberId: string, projectIds: string[] | null) {
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(memberProjects).where(eq(memberProjects.memberId, memberId)).run();
    tx.update(members).set({ allProjects: projectIds === null }).where(eq(members.id, memberId)).run();
    const valid = projectIds?.length ? tx.select({ id: schema.projects.id }).from(schema.projects).where(inArray(schema.projects.id, projectIds)).all() : [];
    for (const p of valid) tx.insert(memberProjects).values({ memberId, projectId: p.id }).run();
  });
}

export function memberProjectIds(memberId: string): string[] {
  return getDb().select({ projectId: memberProjects.projectId }).from(memberProjects).where(eq(memberProjects.memberId, memberId)).all().map((r) => r.projectId);
}

// ------------------------------------------------------------------ which project a dashboard request is about

type Lookup = (id: string) => string | null | undefined;
const byTable =
  (table: typeof forms | typeof widgets | typeof walls | typeof campaigns | typeof testimonials | typeof boosters | typeof seoSnippets | typeof requests | typeof slugRedirects) =>
  (id: string) =>
    getDb().select({ projectId: table.projectId }).from(table).where(eq(table.id, id)).get()?.projectId;

/** /api/admin/<segment>/<id>/…: the object's project. */
const SEGMENTS: Record<string, Lookup> = {
  projects: (id) => id,
  forms: byTable(forms),
  widgets: byTable(widgets),
  walls: byTable(walls),
  campaigns: byTable(campaigns),
  testimonials: byTable(testimonials),
  boosters: byTable(boosters),
  "seo-snippets": byTable(seoSnippets),
  requests: byTable(requests),
  redirects: byTable(slugRedirects),
  runs: (id) => getDb().select({ projectId: taskRuns.projectId }).from(taskRuns).where(eq(taskRuns.id, id)).get()?.projectId,
  answers: (id) =>
    getDb()
      .select({ projectId: testimonials.projectId })
      .from(answers)
      .innerJoin(testimonials, eq(testimonials.id, answers.testimonialId))
      .where(and(eq(answers.id, id)))
      .get()?.projectId,
  // M16: a render (multiclip, social clip, reel) and a highlight reel.
  renders: (id) => getDb().select({ projectId: videoRenders.projectId }).from(videoRenders).where(eq(videoRenders.id, id)).get()?.projectId,
  reels: (id) => getDb().select({ projectId: highlightReels.projectId }).from(highlightReels).where(eq(highlightReels.id, id)).get()?.projectId,
};

const ANALYTICS: Record<string, Lookup> = {
  widget: byTable(widgets),
  form: byTable(forms),
  wall: byTable(walls),
  snippet: byTable(seoSnippets),
  testimonial: byTable(testimonials),
};

/**
 * The project a dashboard API request acts on, read from its path. Null
 * when the path names no project, or names an object that doesn't exist
 * (the route then answers 404 itself).
 */
export function projectOfPath(pathname: string): string | null {
  const parts = pathname.replace(/^\/api\/admin\//, "").split("/").map((p) => decodeURIComponent(p));
  const [segment, id, third] = parts;
  if (segment === "analytics" && id && third) return ANALYTICS[id]?.(third) ?? null;
  if (!id) return null;
  const look = SEGMENTS[segment];
  if (!look || ["preview", "google-places"].includes(id)) return null;
  return look(id) ?? null;
}

// ------------------------------------------------------------------ which project a background job is about

/** Payload fields that name an object, most specific first, and how to find its project. */
const JOB_OBJECTS: [field: string, look: Lookup][] = [
  ["projectId", (id) => getDb().select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, id)).get()?.id],
  ["testimonialId", byTable(testimonials)],
  ["answerId", SEGMENTS.answers],
  ["requestId", byTable(requests)],
  ["widgetId", byTable(widgets)],
  ["runId", SEGMENTS.runs],
  ["sourceId", (id) => getDb().select({ projectId: importSources.projectId }).from(importSources).where(eq(importSources.id, id)).get()?.projectId],
  ["renderId", SEGMENTS.renders],
  ["reelId", SEGMENTS.reels],
  [
    "formVideoId",
    (id) =>
      getDb()
        .select({ projectId: forms.projectId })
        .from(formVideos)
        .innerJoin(forms, eq(forms.id, formVideos.formId))
        .where(eq(formVideos.id, id))
        .get()?.projectId,
  ],
];

/**
 * L19: the project a background job works on, from its payload (a
 * `projectId`, or the testimonial, answer, request, widget, run, import
 * source, render, reel or form video it names). Null when it names none (storage clean-up, digests,
 * webhook deliveries) or the payload isn't readable: such jobs are for
 * admins only.
 */
export function projectOfJob(job: { payload: string }): string | null {
  let payload: unknown;
  try {
    payload = JSON.parse(job.payload);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  for (const [field, look] of JOB_OBJECTS) {
    const id = (payload as Record<string, unknown>)[field];
    if (typeof id === "string" && id) return look(id) ?? null;
  }
  return null;
}
