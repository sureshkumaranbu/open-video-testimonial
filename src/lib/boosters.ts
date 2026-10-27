import crypto from "node:crypto";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/db";
import type { Booster, Project } from "@/db/schema";
import {
  boosterDesignSchema,
  boosterLinksSchema,
  DEFAULT_BOOSTER_MESSAGE,
  defaultBoosterTitle,
  parseDesign,
  parseLinks,
  PLATFORMS,
  type BoosterDesign,
  type BoosterLink,
  type BoosterView,
} from "./booster-config";
import { env } from "./env";
import { formUrl, logoInUse } from "./forms";
import { parseBrand } from "./projects";
import { deleteObject, mediaUrl, removeFiles, saveUpload } from "./storage";
import { firstIssue, slugSchema } from "./validation";

export * from "./booster-config";

const { boosters, boosterClicks, slugRedirects, forms } = schema;

/**
 * Review booster pages (BOOST-01..05): several per project at
 * /b/<project>/<booster>, each a draft until it's public. Old links answer
 * 308 (D17), so printed QR codes keep working after a rename. Clicks are
 * counted per link and day, and nothing else is stored: no IPs, no user
 * agents, no cookies (BOOST-05).
 */

export class BoosterError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Conn = Db | Tx;
const NAME_MAX = 120;
const SLUG_MAX = 48;
const notFound = () => new BoosterError(404, "Booster not found");

function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_MAX)
    .replace(/^-+|-+$/g, "");
  return slug.length >= 2 ? slug : "reviews";
}

function parseSlug(raw: string): string {
  const parsed = slugSchema.safeParse(raw);
  if (!parsed.success) throw new BoosterError(400, firstIssue(parsed.error));
  return parsed.data;
}

const aliasWhere = (projectId: string, slug: string) =>
  and(eq(slugRedirects.kind, "booster"), eq(slugRedirects.scope, projectId), eq(slugRedirects.oldSlug, slug));

function freeSlug(db: Conn, projectId: string, base: string): string {
  const taken = new Set([
    ...db.select({ slug: boosters.slug }).from(boosters).where(eq(boosters.projectId, projectId)).all().map((r) => r.slug),
    ...db
      .select({ slug: slugRedirects.oldSlug })
      .from(slugRedirects)
      .where(and(eq(slugRedirects.kind, "booster"), eq(slugRedirects.scope, projectId)))
      .all()
      .map((r) => r.slug),
  ]);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const slug = base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "") + suffix;
    if (!taken.has(slug)) return slug;
  }
}

/** A live slug beats an old link (D17): refused when another booster uses it, and an old link with it is dropped. */
function claimSlug(db: Conn, projectId: string, slug: string, boosterId?: string): boolean {
  const live = db.select({ id: boosters.id }).from(boosters).where(and(eq(boosters.projectId, projectId), eq(boosters.slug, slug))).get();
  if (live && live.id !== boosterId) throw new BoosterError(409, `Another booster already uses “${slug}”`);
  return db.delete(slugRedirects).where(aliasWhere(projectId, slug)).run().changes > 0;
}

// ------------------------------------------------------------------ reads

export function listBoosters(projectId: string): Booster[] {
  return getDb().select().from(boosters).where(eq(boosters.projectId, projectId)).orderBy(asc(boosters.createdAt), asc(boosters.id)).all();
}

export function getBooster(id: string): Booster | null {
  return getDb().select().from(boosters).where(eq(boosters.id, id)).get() ?? null;
}

/** Follows old links: `redirectedFrom` is set when it did. */
export function getBoosterBySlug(projectId: string, slug: string): { booster: Booster; redirectedFrom?: string } | null {
  const db = getDb();
  const live = db.select().from(boosters).where(and(eq(boosters.projectId, projectId), eq(boosters.slug, slug))).get();
  if (live) return { booster: live };
  const alias = db.select({ boosterId: slugRedirects.boosterId }).from(slugRedirects).where(aliasWhere(projectId, slug)).get();
  const booster = alias?.boosterId ? db.select().from(boosters).where(and(eq(boosters.id, alias.boosterId), eq(boosters.projectId, projectId))).get() : undefined;
  return booster ? { booster, redirectedFrom: slug } : null;
}

export const boosterPath = (project: Pick<Project, "slug">, b: Pick<Booster, "slug">) => `/b/${project.slug}/${b.slug}`;
export const boosterUrl = (project: Pick<Project, "slug">, b: Pick<Booster, "slug">) => `${env.publicUrl}${boosterPath(project, b)}`;

// ------------------------------------------------------------------ writes

/** A new draft, coloured from the brand kit, with our default title and message and no links yet. */
export function createBooster(project: Pick<Project, "id" | "name" | "brand">, input: { name: string; slug?: string }): Booster {
  const name = input.name.trim().slice(0, NAME_MAX).trim();
  if (!name) throw new BoosterError(400, "Give the booster a name");
  const brand = parseBrand(project.brand).colors;
  const design = boosterDesignSchema.parse({
    ...(brand.background ? { background: brand.background } : {}),
    ...(brand.button ? { button: brand.button } : brand.primary ? { button: brand.primary } : {}),
    ...(brand.buttonText ? { buttonText: brand.buttonText } : {}),
  });
  return getDb().transaction((tx) => {
    const slug = input.slug ? parseSlug(input.slug) : freeSlug(tx, project.id, slugify(name));
    if (input.slug) claimSlug(tx, project.id, slug);
    const now = new Date();
    return tx
      .insert(boosters)
      .values({
        id: crypto.randomUUID(),
        projectId: project.id,
        slug,
        name,
        title: defaultBoosterTitle(project.name),
        message: DEFAULT_BOOSTER_MESSAGE,
        links: "[]",
        design: JSON.stringify(design),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  });
}

export const boosterPatchBody = z
  .object({
    name: z.string().max(NAME_MAX),
    published: z.boolean(),
    // No defaults here: a PATCH that leaves them out must leave them alone.
    title: z.string().trim().max(120),
    message: z.string().trim().max(600),
    links: boosterLinksSchema,
    design: boosterDesignSchema,
  })
  .partial();
export type BoosterPatch = z.infer<typeof boosterPatchBody>;

/** Saves the editor's changes; each part sent replaces that part whole. Form links must be the project's own forms. */
export function updateBooster(id: string, patch: BoosterPatch): Booster | null {
  const b = getBooster(id);
  if (!b) return null;
  const set: Partial<typeof boosters.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name.trim().slice(0, NAME_MAX).trim() || b.name;
  if (patch.published !== undefined) set.published = patch.published;
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.message !== undefined) set.message = patch.message;
  if (patch.design !== undefined) set.design = JSON.stringify(patch.design);
  if (patch.links !== undefined) {
    const own = new Set(getDb().select({ id: forms.id }).from(forms).where(eq(forms.projectId, b.projectId)).all().map((f) => f.id));
    if (patch.links.some((l) => l.platform === "form" && !own.has(l.formId ?? ""))) throw new BoosterError(400, "Choose one of this project's forms");
    set.links = JSON.stringify(patch.links.map((l) => (l.platform === "form" ? { ...l, url: "" } : { ...l, formId: null })));
  }
  return getDb().update(boosters).set(set).where(eq(boosters.id, id)).returning().get() ?? null;
}

/** A new link; the old one keeps working as a 308 (D17). `droppedAlias` when the new slug was another booster's old link. */
export function changeBoosterSlug(id: string, slug: string): { booster: Booster; droppedAlias: boolean } {
  const next = parseSlug(slug);
  return getDb().transaction((tx) => {
    const b = tx.select().from(boosters).where(eq(boosters.id, id)).get();
    if (!b) throw notFound();
    if (b.slug === next) return { booster: b, droppedAlias: false };
    const droppedAlias = claimSlug(tx, b.projectId, next, b.id);
    const now = new Date();
    tx.insert(slugRedirects)
      .values({ id: crypto.randomUUID(), kind: "booster", scope: b.projectId, projectId: b.projectId, boosterId: b.id, oldSlug: b.slug, createdAt: now })
      .onConflictDoUpdate({
        target: [slugRedirects.kind, slugRedirects.scope, slugRedirects.oldSlug],
        set: { boosterId: b.id, projectId: b.projectId, createdAt: now },
      })
      .run();
    return { booster: tx.update(boosters).set({ slug: next, updatedAt: now }).where(eq(boosters.id, id)).returning().get(), droppedAlias };
  });
}

/** Deletes the booster, its old links and its click counts; its logo goes too unless something else uses it. */
export async function deleteBooster(id: string): Promise<boolean> {
  const b = getBooster(id);
  if (!b) return false;
  getDb().delete(boosters).where(eq(boosters.id, id)).run();
  if (b.logoKey && !logoInUse(b.logoKey)) await removeFiles([b.logoKey]);
  return true;
}

/** Stores a PNG, JPEG, WebP or GIF (never SVG) as the booster's logo. Public only while the booster is. */
export async function setBoosterLogo(id: string, file: File): Promise<Booster> {
  const b = getBooster(id);
  if (!b) throw notFound();
  const stored = await saveUpload(file, "image");
  const updated = getDb().update(boosters).set({ logoKey: stored.key, updatedAt: new Date() }).where(eq(boosters.id, id)).returning().get();
  if (!updated) {
    await deleteObject(stored.key);
    throw notFound();
  }
  if (b.logoKey && b.logoKey !== stored.key && !logoInUse(b.logoKey)) await removeFiles([b.logoKey]);
  return updated;
}

export async function removeBoosterLogo(id: string): Promise<Booster> {
  const b = getBooster(id);
  if (!b) throw notFound();
  if (!b.logoKey) return b;
  const updated = getDb().update(boosters).set({ logoKey: null, updatedAt: new Date() }).where(eq(boosters.id, id)).returning().get()!;
  if (!logoInUse(b.logoKey)) await removeFiles([b.logoKey]);
  return updated;
}

// ------------------------------------------------------------------ the page

/**
 * Where a link sends people: the stored address, or a form link's current
 * address. Null for a form link whose form was deleted. The click counter
 * only ever redirects here, never to anything from the request (no open
 * redirect).
 */
export function linkTarget(project: Pick<Project, "id" | "slug">, link: BoosterLink): string | null {
  if (link.platform !== "form") return link.url || null;
  const form = link.formId ? getDb().select().from(forms).where(eq(forms.id, link.formId)).get() : undefined;
  return form && form.projectId === project.id ? `${env.publicUrl}${formUrl(project, form)}` : null;
}

export const linkLabel = (link: Pick<BoosterLink, "label" | "platform">) => link.label.trim() || PLATFORMS[link.platform].label;

/**
 * What the page shows. Every link with a target is in it, in order (BOOST-03:
 * no gating, nothing depends on the visitor). On the public page each link
 * goes through the click counter; in the preview, straight to its target.
 */
export function boosterView(
  project: Pick<Project, "id" | "slug" | "name" | "logoKey">,
  b: Pick<Booster, "slug" | "title" | "message" | "logoKey"> & { links: BoosterLink[]; design: BoosterDesign },
  o: { preview?: boolean } = {},
): BoosterView {
  const base = boosterPath(project, b);
  const logoKey = b.logoKey ?? project.logoKey;
  return {
    title: b.title.trim() || defaultBoosterTitle(project.name),
    message: b.message.trim(),
    projectName: project.name,
    logoUrl: logoKey ? mediaUrl(logoKey) : null,
    design: b.design,
    links: b.links.flatMap((l) => {
      const target = linkTarget(project, l);
      if (!target) return [];
      return [{ id: l.id, platform: l.platform, label: linkLabel(l), href: o.preview ? target : `${base}/go/${l.id}` }];
    }),
  };
}

export const viewOf = (project: Project, b: Booster, o: { preview?: boolean } = {}) =>
  boosterView(project, { ...b, links: parseLinks(b.links), design: parseDesign(b.design) }, o);

// ------------------------------------------------------------------ clicks (BOOST-05)

/** Today in UTC, YYYY-MM-DD. */
export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

/** Adds one to today's count for the link. One upsert, nothing about the visitor. */
export function recordClick(boosterId: string, linkId: string, now = new Date()) {
  getDb()
    .insert(boosterClicks)
    .values({ boosterId, linkId, day: utcDay(now), count: 1 })
    .onConflictDoUpdate({ target: [boosterClicks.boosterId, boosterClicks.linkId, boosterClicks.day], set: { count: sql`${boosterClicks.count} + 1` } })
    .run();
}

export type ClickStats = {
  days: string[];
  /** Per link still on the page, in page order, then "removed" for links taken off since. */
  links: { id: string; label: string; platform: string; total: number; daily: number[] }[];
  total: number;
};

/** Daily counts for the last `days` days (today included), per link. */
export function clickStats(b: Booster, days = 30, now = new Date()): ClickStats {
  const list: string[] = [];
  for (let i = days - 1; i >= 0; i--) list.push(utcDay(new Date(now.getTime() - i * 86_400_000)));
  const rows = getDb()
    .select()
    .from(boosterClicks)
    .where(and(eq(boosterClicks.boosterId, b.id), gte(boosterClicks.day, list[0])))
    .all();
  const links = parseLinks(b.links);
  const known = new Set(links.map((l) => l.id));
  const series = (ids: (id: string) => boolean) => list.map((day) => rows.filter((r) => r.day === day && ids(r.linkId)).reduce((n, r) => n + r.count, 0));
  const out = links.map((l) => {
    const daily = series((id) => id === l.id);
    return { id: l.id, label: linkLabel(l), platform: l.platform, total: daily.reduce((a, n) => a + n, 0), daily };
  });
  const removed = series((id) => !known.has(id));
  if (removed.some(Boolean)) out.push({ id: "removed", label: "Links you've removed", platform: "custom", total: removed.reduce((a, n) => a + n, 0), daily: removed });
  return { days: list, links: out, total: out.reduce((a, l) => a + l.total, 0) };
}

// ------------------------------------------------------------------ admin shape

export function boosterToAdmin(b: Booster, project: Pick<Project, "slug">) {
  return {
    id: b.id,
    projectId: b.projectId,
    slug: b.slug,
    name: b.name,
    published: b.published,
    title: b.title,
    message: b.message,
    links: parseLinks(b.links),
    design: parseDesign(b.design),
    logoUrl: b.logoKey ? mediaUrl(b.logoKey) : null,
    url: boosterUrl(project, b),
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}
export type AdminBooster = ReturnType<typeof boosterToAdmin>;

export const createBoosterBody = z.object({ name: z.string().trim().min(1, "Give the booster a name").max(NAME_MAX), slug: z.string().max(SLUG_MAX).optional() });
