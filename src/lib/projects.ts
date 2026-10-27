import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/db";
import type { Project, RedirectKind } from "@/db/schema";
import { recordHistory } from "./history";
import { deleteObject, removeFiles, saveUpload } from "./storage";
import { createProject, getProjectById, getProjectBySlug, updateProject } from "./testimonials";
import { discardUpload } from "./uploads";
import { brandSchema, firstIssue, slugSchema, tagNameSchema, type Brand } from "./validation";

/**
 * Project settings (TEAM-04): the link (slug) with old links kept as
 * redirects (D17), deleting a project and its files, the logo and brand kit,
 * and the tags manager.
 */

const { projects, slugRedirects, tags, testimonialTags, uploads, forms, walls, boosters } = schema;

/** A refused change; `status` is what an API route answers with. */
export class ProjectError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Another live project already uses the slug (409). An old link with it doesn't count: a live slug beats an alias. */
export class SlugTakenError extends ProjectError {
  constructor(slug: string) {
    super(409, `Another project already uses “${slug}”. Pick a different link.`);
  }
}

const notFound = () => new ProjectError(404, "Project not found");

function parseSlug(raw: string): string {
  const parsed = slugSchema.safeParse(raw);
  if (!parsed.success) throw new ProjectError(400, firstIssue(parsed.error));
  return parsed.data;
}

/** The project alias row for an old slug ("" scope: project slugs are one global namespace). */
const aliasWhere = (slug: string) =>
  and(eq(slugRedirects.kind, "project"), eq(slugRedirects.scope, ""), eq(slugRedirects.oldSlug, slug));

// ------------------------------------------------------------------ slugs

/**
 * The project a public link names: by its live slug first, then by an old
 * slug it had (`canonical` false), so links made before a rename keep
 * working. Pages answer an alias with a 308 to the live slug; the widget feed
 * and the submit routes answer it directly.
 */
export function findProjectBySlugOrAlias(slug: string): { project: Project; canonical: boolean } | null {
  const live = getProjectBySlug(slug);
  if (live) return { project: live, canonical: true };
  const alias = getDb().select({ projectId: slugRedirects.projectId }).from(slugRedirects).where(aliasWhere(slug)).get();
  const project = alias ? getProjectById(alias.projectId) : null;
  return project ? { project, canonical: false } : null;
}

/** `path` with the page's query string, for a redirect that keeps it (?r= and the rest). */
export function withQuery(path: string, query: Record<string, string | string[] | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, one);
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export type SlugCheck = {
  slug: string;
  available: boolean;
  /** Why not, when it isn't. */
  error?: string;
  /** Taking it replaces an old link of this other project: its links with this slug will open the new owner. */
  replacesAliasOf?: { id: string; name: string };
};

/** Whether `projectId` (or a new project, when absent) can take `slug`, and what that would replace. */
export function checkSlug(raw: string, projectId?: string): SlugCheck {
  const parsed = slugSchema.safeParse(raw);
  if (!parsed.success) return { slug: raw, available: false, error: firstIssue(parsed.error) };
  const slug = parsed.data;
  const live = getProjectBySlug(slug);
  if (live && live.id !== projectId) return { slug, available: false, error: new SlugTakenError(slug).message };
  const alias = getDb().select({ projectId: slugRedirects.projectId }).from(slugRedirects).where(aliasWhere(slug)).get();
  const owner = alias && alias.projectId !== projectId ? getProjectById(alias.projectId) : null;
  return { slug, available: true, ...(owner ? { replacesAliasOf: { id: owner.id, name: owner.name } } : {}) };
}

/** Takes `slug` for a project: refused while another project uses it; any old link with it is dropped (D17). */
function claimSlug(tx: Tx, slug: string, projectId?: string) {
  const live = tx.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).get();
  if (live && live.id !== projectId) throw new SlugTakenError(slug);
  tx.delete(slugRedirects).where(aliasWhere(slug)).run();
}

/**
 * Gives the project a new link. The old slug becomes a redirect, so /c, /wall
 * and /embed links answer 308 to the new one (keeping their query, so
 * personal ?r= links still prefill) and widget embeds keep loading. Throws
 * SlugTakenError when a live project holds the slug; an old link of any
 * project with that slug is dropped (renaming back to an old slug drops it too).
 */
export function changeProjectSlug(id: string, slug: string): Project {
  const next = parseSlug(slug);
  return getDb().transaction((tx) => {
    const project = tx.select().from(projects).where(eq(projects.id, id)).get();
    if (!project) throw notFound();
    if (project.slug === next) return project;
    claimSlug(tx, next, id);
    tx.insert(slugRedirects)
      .values({ id: crypto.randomUUID(), kind: "project", scope: "", projectId: id, oldSlug: project.slug, createdAt: new Date() })
      .onConflictDoUpdate({
        target: [slugRedirects.kind, slugRedirects.scope, slugRedirects.oldSlug],
        set: { projectId: id, formId: null, wallId: null, boosterId: null, createdAt: new Date() },
      })
      .run();
    return tx.update(projects).set({ slug: next }).where(eq(projects.id, id)).returning().get();
  });
}

/**
 * createProject, taking over an old link with the same slug (a live slug
 * beats an alias, D17). `replacedAliasOf` names the project whose old links
 * with this slug now open the new one, for the dashboard to warn about.
 */
export function createProjectClaimingSlug(
  input: Parameters<typeof createProject>[0],
): { project: Project; replacedAliasOf?: { id: string; name: string } } {
  const slug = parseSlug(input.slug);
  const check = checkSlug(slug);
  return getDb().transaction((tx) => {
    claimSlug(tx, slug);
    // createProject's own transaction becomes a savepoint inside this one.
    const project = createProject({ ...input, slug });
    return { project, ...(check.replacesAliasOf ? { replacedAliasOf: check.replacesAliasOf } : {}) };
  });
}

export type RedirectInfo = {
  id: string;
  kind: RedirectKind;
  oldSlug: string;
  /** Where the old link pointed, e.g. /c/acme or /f/acme-co/old-form. */
  oldPath: string;
  /** What it opens now: the project, or the form or wall by name. */
  target: string;
  createdAt: Date;
};

/** Every old link that still works for the project: its own and its forms' and walls', newest first. */
export function listRedirects(projectId: string): RedirectInfo[] {
  const project = getProjectById(projectId);
  if (!project) return [];
  const rows = getDb()
    .select({
      id: slugRedirects.id,
      kind: slugRedirects.kind,
      oldSlug: slugRedirects.oldSlug,
      createdAt: slugRedirects.createdAt,
      formName: forms.name,
      wallName: walls.name,
      boosterName: boosters.name,
    })
    .from(slugRedirects)
    .leftJoin(forms, eq(forms.id, slugRedirects.formId))
    .leftJoin(walls, eq(walls.id, slugRedirects.wallId))
    .leftJoin(boosters, eq(boosters.id, slugRedirects.boosterId))
    .where(eq(slugRedirects.projectId, projectId))
    .orderBy(desc(slugRedirects.createdAt), asc(slugRedirects.oldSlug))
    .all();
  // A project made some other way (an archive import) can hold an old slug live; the live one wins, so that link isn't ours.
  const aliasSlugs = rows.filter((r) => r.kind === "project").map((r) => r.oldSlug);
  const live = new Set(
    aliasSlugs.length
      ? getDb().select({ slug: projects.slug }).from(projects).where(inArray(projects.slug, aliasSlugs)).all().map((p) => p.slug)
      : [],
  );
  return rows.filter((r) => r.kind !== "project" || !live.has(r.oldSlug)).map((r) => ({
    id: r.id,
    kind: r.kind,
    oldSlug: r.oldSlug,
    createdAt: r.createdAt,
    oldPath:
      r.kind === "form"
        ? `/f/${project.slug}/${r.oldSlug}`
        : r.kind === "wall"
          ? `/wall/${project.slug}/${r.oldSlug}`
          : r.kind === "booster"
            ? `/b/${project.slug}/${r.oldSlug}`
            : `/c/${r.oldSlug}`,
    target:
      r.kind === "form"
        ? `Form “${r.formName ?? ""}”`
        : r.kind === "wall"
          ? `Wall “${r.wallName ?? ""}”`
          : r.kind === "booster"
            ? `Booster “${r.boosterName ?? ""}”`
            : project.name,
  }));
}

/** Stops an old link working (it then 404s). False when there's no such redirect. */
export function deleteRedirect(id: string): boolean {
  return Boolean(getDb().delete(slugRedirects).where(eq(slugRedirects.id, id)).returning().get());
}

// ----------------------------------------------------------------- delete

/**
 * Every stored file of the project: its testimonials' own files, their
 * answers' videos and their images, form, wall, booster and project logos,
 * wall covers and customers' photos.
 */
export function projectMediaKeys(projectId: string): string[] {
  const rows = getDb().all<{ key: string | null }>(sql`
    SELECT avatar_key AS key FROM testimonials WHERE project_id = ${projectId}
    UNION SELECT video_key FROM testimonials WHERE project_id = ${projectId}
    UNION SELECT video_original_key FROM testimonials WHERE project_id = ${projectId}
    UNION SELECT poster_key FROM testimonials WHERE project_id = ${projectId}
    UNION SELECT company_logo_key FROM testimonials WHERE project_id = ${projectId}
    UNION SELECT a.video_key FROM answers a JOIN testimonials t ON t.id = a.testimonial_id WHERE t.project_id = ${projectId}
    UNION SELECT a.video_original_key FROM answers a JOIN testimonials t ON t.id = a.testimonial_id WHERE t.project_id = ${projectId}
    UNION SELECT a.poster_key FROM answers a JOIN testimonials t ON t.id = a.testimonial_id WHERE t.project_id = ${projectId}
    UNION SELECT i.key FROM testimonial_images i JOIN testimonials t ON t.id = i.testimonial_id WHERE t.project_id = ${projectId}
    UNION SELECT logo_key FROM forms WHERE project_id = ${projectId}
    UNION SELECT logo_key FROM walls WHERE project_id = ${projectId}
    UNION SELECT cover_key FROM walls WHERE project_id = ${projectId}
    UNION SELECT favicon_key FROM walls WHERE project_id = ${projectId}
    UNION SELECT key FROM share_assets WHERE project_id = ${projectId}
    UNION SELECT logo_key FROM boosters WHERE project_id = ${projectId}
    UNION SELECT logo_key FROM projects WHERE id = ${projectId}
    UNION SELECT avatar_key FROM customers WHERE project_id = ${projectId}`);
  return rows.map((r) => r.key).filter((k): k is string => Boolean(k));
}

/** Whether any row (of any project) still points at a file. */
export function fileInUse(key: string): boolean {
  return Boolean(
    getDb().get(sql`
      SELECT 1 FROM testimonials
        WHERE avatar_key = ${key} OR video_key = ${key} OR video_original_key = ${key} OR poster_key = ${key} OR company_logo_key = ${key}
      UNION ALL SELECT 1 FROM answers WHERE video_key = ${key} OR video_original_key = ${key} OR poster_key = ${key}
      UNION ALL SELECT 1 FROM testimonial_images WHERE key = ${key}
      UNION ALL SELECT 1 FROM customers WHERE avatar_key = ${key}
      UNION ALL SELECT 1 FROM projects WHERE logo_key = ${key}
      UNION ALL SELECT 1 FROM forms WHERE logo_key = ${key}
      UNION ALL SELECT 1 FROM walls WHERE logo_key = ${key} OR cover_key = ${key} OR favicon_key = ${key}
      UNION ALL SELECT 1 FROM boosters WHERE logo_key = ${key}
      UNION ALL SELECT 1 FROM share_assets WHERE key = ${key}
      LIMIT 1`),
  );
}

/**
 * Deletes the project for good once `confirm` is its name, typed. The rows
 * go in one DELETE (testimonials, forms, requests, consent records, tags,
 * webhooks, old links… all cascade), then each file is removed from storage
 * and unfinished uploads are discarded. No per-testimonial webhooks are sent.
 * Null when there's no such project; `files` counts the files removed.
 */
export async function deleteProject(id: string, o: { confirm: string }): Promise<{ files: number } | null> {
  const project = getProjectById(id);
  if (!project) return null;
  if (o.confirm.trim() !== project.name) throw new ProjectError(400, "Type the project's name exactly as it's shown to delete it.");
  const keys = projectMediaKeys(id);
  const db = getDb();
  const open = db.select({ id: uploads.id }).from(uploads).where(eq(uploads.projectId, id)).all();
  if (!db.delete(projects).where(eq(projects.id, id)).returning({ id: projects.id }).get()) return null;
  await Promise.allSettled(open.map((u) => discardUpload(u.id)));
  // Files that can't be removed now are retried in the background.
  return { files: await removeFiles(keys.filter((k) => !fileInUse(k))) };
}

// ------------------------------------------------------------ brand kit

const EMPTY_BRAND: Brand = { colors: {}, fonts: {} };

/** The stored brand kit; never throws (anything unreadable falls back to empty). */
export function parseBrand(raw: string | null | undefined): Brand {
  try {
    const parsed = brandSchema.safeParse(JSON.parse(raw || "{}"));
    return parsed.success ? parsed.data : EMPTY_BRAND;
  } catch {
    return EMPTY_BRAND;
  }
}

/** Replaces the brand kit: the colours and fonts new forms, widgets and walls start with. */
export function updateBrand(projectId: string, brand: Brand): Project {
  const parsed = brandSchema.safeParse(brand);
  if (!parsed.success) throw new ProjectError(400, firstIssue(parsed.error));
  const project = updateProject(projectId, { brand: parsed.data });
  if (!project) throw notFound();
  return project;
}

/** Stores an image (PNG, JPEG, WebP or GIF; never SVG) as the project's logo, replacing the old one. Public, like form logos. */
export async function setProjectLogo(projectId: string, file: File): Promise<Project> {
  const existing = getProjectById(projectId);
  if (!existing) throw notFound();
  const stored = await saveUpload(file, "image");
  const project = getDb().update(projects).set({ logoKey: stored.key }).where(eq(projects.id, projectId)).returning().get();
  if (!project) {
    await deleteObject(stored.key);
    throw notFound();
  }
  if (existing.logoKey && existing.logoKey !== stored.key && !fileInUse(existing.logoKey)) await removeFiles([existing.logoKey]);
  return project;
}

export async function removeProjectLogo(projectId: string): Promise<Project> {
  const existing = getProjectById(projectId);
  if (!existing) throw notFound();
  if (!existing.logoKey) return existing;
  const project = getDb().update(projects).set({ logoKey: null }).where(eq(projects.id, projectId)).returning().get();
  if (!fileInUse(existing.logoKey)) await removeFiles([existing.logoKey]);
  return project;
}

// ------------------------------------------------------------------ tags

export type TagUsage = { name: string; count: number };

/** The project's tags A–Z, with how many testimonials (in any status) have each. Unused tags are listed too. */
export function listTagUsage(projectId: string): TagUsage[] {
  return getDb()
    .select({ name: tags.name, count: sql<number>`count(${testimonialTags.testimonialId})` })
    .from(tags)
    .leftJoin(testimonialTags, eq(testimonialTags.tagId, tags.id))
    .where(eq(tags.projectId, projectId))
    .groupBy(tags.id)
    .orderBy(tags.name)
    .all();
}

/** Tags are stored trimmed and lower-cased, as the dashboard saves them. */
function tagName(raw: string): string {
  const parsed = tagNameSchema.safeParse(raw);
  if (!parsed.success) throw new ProjectError(400, "Tag names need 1 to 32 characters.");
  return parsed.data.toLowerCase();
}

function tagRow(tx: Tx, projectId: string, name: string) {
  return tx.select().from(tags).where(and(eq(tags.projectId, projectId), eq(tags.name, name))).get() ?? null;
}

/** The tag names of each testimonial that has any of `tagIds`. */
function tagsOfTagged(tx: Tx, tagIds: string[]): Map<string, string[]> {
  if (!tagIds.length) return new Map();
  const tagged = tx.select({ id: testimonialTags.testimonialId }).from(testimonialTags).where(inArray(testimonialTags.tagId, tagIds));
  const rows = tx
    .select({ testimonialId: testimonialTags.testimonialId, name: tags.name })
    .from(testimonialTags)
    .innerJoin(tags, eq(tags.id, testimonialTags.tagId))
    .where(inArray(testimonialTags.testimonialId, tagged))
    .all();
  const byId = new Map<string, string[]>();
  for (const r of rows) byId.set(r.testimonialId, [...(byId.get(r.testimonialId) ?? []), r.name]);
  return byId;
}

/** A "tags" history entry on each testimonial whose tags changed, so the change shows in its history. */
function recordTagChanges(tx: Tx, before: Map<string, string[]>, by: string | undefined) {
  const now = new Date();
  for (const [testimonialId, old] of before) {
    const next = tx
      .select({ name: tags.name })
      .from(testimonialTags)
      .innerJoin(tags, eq(tags.id, testimonialTags.tagId))
      .where(eq(testimonialTags.testimonialId, testimonialId))
      .all()
      .map((r) => r.name)
      .sort();
    const prev = [...old].sort();
    if (JSON.stringify(prev) === JSON.stringify(next)) continue;
    recordHistory(tx, { testimonialId, actor: "owner", actorEmail: by, action: "tags", diff: { tags: [prev, next] }, at: now });
  }
}

/**
 * Renames a tag on every testimonial that has it. Refused (409) when the
 * project already has a tag with the new name: merging is a separate,
 * deliberate step (mergeTags).
 */
export function renameTag(projectId: string, from: string, to: string, o: { by?: string } = {}): void {
  const source = tagName(from);
  const target = tagName(to);
  getDb().transaction((tx) => {
    const tag = tagRow(tx, projectId, source);
    if (!tag) throw new ProjectError(404, `There's no tag called “${source}”.`);
    if (source === target) return;
    if (tagRow(tx, projectId, target)) {
      throw new ProjectError(409, `There's already a tag called “${target}”. Merge the two tags instead.`);
    }
    const before = tagsOfTagged(tx, [tag.id]);
    tx.update(tags).set({ name: target }).where(eq(tags.id, tag.id)).run();
    recordTagChanges(tx, before, o.by);
  });
}

/**
 * Moves every testimonial tagged with any of `from` onto `into` (made if the
 * project has no such tag yet), then deletes the `from` tags.
 */
export function mergeTags(projectId: string, from: string[], into: string, o: { by?: string } = {}): void {
  const target = tagName(into);
  const names = [...new Set(from.map(tagName))].filter((n) => n !== target);
  if (!names.length) throw new ProjectError(400, "Pick at least one other tag to merge.");
  getDb().transaction((tx) => {
    const sources = tx.select().from(tags).where(and(eq(tags.projectId, projectId), inArray(tags.name, names))).all();
    if (sources.length !== names.length) {
      const missing = names.find((n) => !sources.some((s) => s.name === n));
      throw new ProjectError(404, `There's no tag called “${missing}”.`);
    }
    const ids = sources.map((s) => s.id);
    const before = tagsOfTagged(tx, ids);
    tx.insert(tags).values({ id: crypto.randomUUID(), projectId, name: target }).onConflictDoNothing().run();
    const intoTag = tagRow(tx, projectId, target)!;
    for (const testimonialId of before.keys()) {
      tx.insert(testimonialTags).values({ testimonialId, tagId: intoTag.id }).onConflictDoNothing().run();
    }
    // Their testimonial_tags rows cascade.
    tx.delete(tags).where(inArray(tags.id, ids)).run();
    recordTagChanges(tx, before, o.by);
  });
}

/** Removes a tag from every testimonial and from the project. */
export function deleteTag(projectId: string, name: string, o: { by?: string } = {}): void {
  const target = tagName(name);
  getDb().transaction((tx) => {
    const tag = tagRow(tx, projectId, target);
    if (!tag) throw new ProjectError(404, `There's no tag called “${target}”.`);
    const before = tagsOfTagged(tx, [tag.id]);
    tx.delete(tags).where(eq(tags.id, tag.id)).run();
    recordTagChanges(tx, before, o.by);
  });
}
