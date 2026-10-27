import type { Metadata } from "next";
import { z } from "zod";
import { and, asc, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Project, Wall } from "@/db/schema";
import { env } from "./env";
import { formUrl, logoInUse } from "./forms";
import { parseBrand } from "./projects";
import { feedAggregate, listFeed, ratingSummary } from "./public-feed";
import { reviewJsonLd } from "./seo";
import { deleteObject, mediaUrl, removeFiles, saveUpload } from "./storage";
import { firstIssue, slugSchema } from "./validation";
import {
  defaultWallConfig,
  parseWallConfigLenient,
  parseWallTheme,
  resolveTab,
  WALL_THEMES,
  wallConfigSchema,
  wallTabs,
  type WallConfig,
  type WallConfigInput,
  type WallTheme,
} from "./wall-config";
import type { FeedAggregate, FeedItem, PublicFilters } from "./widget-config";

export * from "./wall-config";

const { walls, slugRedirects, forms, testimonials } = schema;

/**
 * Walls of love (WALL-01..03): several per project at /wall/<project>/<wall>,
 * each a draft until published. One may be the project's main wall, which
 * /wall/<project> then shows in place of the legacy page. Drafts are never
 * public: their page, items, OG image and images all 404.
 */

export class WallError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const NAME_MAX = 120;
const SLUG_MAX = 48;
const notFound = () => new WallError(404, "Wall not found");

type Conn = Pick<ReturnType<typeof getDb>, "select" | "insert" | "update" | "delete">;

export function wallConfig(w: Pick<Wall, "config">): WallConfig {
  try {
    return parseWallConfigLenient(JSON.parse(w.config || "{}"));
  } catch {
    return defaultWallConfig();
  }
}

function parseConfig(input: unknown): WallConfig {
  const parsed = wallConfigSchema.safeParse(input ?? {});
  if (!parsed.success) throw new WallError(400, firstIssue(parsed.error));
  return parsed.data;
}

/** "Customer stories!" → "customer-stories". */
function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_MAX)
    .replace(/^-+|-+$/g, "");
  return slug.length >= 2 ? slug : "wall";
}

function parseSlug(raw: string): string {
  const parsed = slugSchema.safeParse(raw);
  if (!parsed.success) throw new WallError(400, firstIssue(parsed.error));
  return parsed.data;
}

/** `base`, `base-2`…: the first that no wall of the project uses, now or as an old link. */
function freeSlug(db: Conn, projectId: string, base: string): string {
  const taken = new Set([
    ...db.select({ slug: walls.slug }).from(walls).where(eq(walls.projectId, projectId)).all().map((r) => r.slug),
    ...db
      .select({ slug: slugRedirects.oldSlug })
      .from(slugRedirects)
      .where(and(eq(slugRedirects.kind, "wall"), eq(slugRedirects.scope, projectId)))
      .all()
      .map((r) => r.slug),
  ]);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const slug = base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "") + suffix;
    if (!taken.has(slug)) return slug;
  }
}

/** Takes `slug` for a wall of the project: refused when another wall uses it; an old link with it is dropped (a live slug beats an alias, D17). */
function claimSlug(db: Conn, projectId: string, slug: string, wallId?: string): boolean {
  const live = db.select({ id: walls.id }).from(walls).where(and(eq(walls.projectId, projectId), eq(walls.slug, slug))).get();
  if (live && live.id !== wallId) throw new WallError(409, `Another wall already uses “${slug}”`);
  const dropped = db
    .delete(slugRedirects)
    .where(and(eq(slugRedirects.kind, "wall"), eq(slugRedirects.scope, projectId), eq(slugRedirects.oldSlug, slug)))
    .run();
  return dropped.changes > 0;
}

// ------------------------------------------------------------------ reads

export function listWalls(projectId: string): Wall[] {
  return getDb().select().from(walls).where(eq(walls.projectId, projectId)).orderBy(asc(walls.createdAt), asc(walls.id)).all();
}

export function getWall(id: string): Wall | null {
  return getDb().select().from(walls).where(eq(walls.id, id)).get() ?? null;
}

/** Follows slug_redirects: `redirectedFrom` is the old slug when it did. */
export function getWallBySlug(projectId: string, slug: string): { wall: Wall; redirectedFrom?: string } | null {
  const db = getDb();
  const live = db.select().from(walls).where(and(eq(walls.projectId, projectId), eq(walls.slug, slug))).get();
  if (live) return { wall: live };
  const alias = db
    .select({ wallId: slugRedirects.wallId })
    .from(slugRedirects)
    .where(and(eq(slugRedirects.kind, "wall"), eq(slugRedirects.scope, projectId), eq(slugRedirects.oldSlug, slug)))
    .get();
  const wall = alias?.wallId ? db.select().from(walls).where(and(eq(walls.id, alias.wallId), eq(walls.projectId, projectId))).get() : undefined;
  return wall ? { wall, redirectedFrom: slug } : null;
}

/** The wall /wall/<project> shows: the main one, while it's published (else the legacy page stays). */
export function getMainWall(projectId: string): Wall | null {
  return (
    getDb()
      .select()
      .from(walls)
      .where(and(eq(walls.projectId, projectId), eq(walls.isMain, true), eq(walls.published, true)))
      .get() ?? null
  );
}

// ------------------------------------------------------------------ writes

export type CreateWallInput = { name: string; slug?: string; theme?: WallTheme; config?: WallConfigInput };

export function createWall(project: Pick<Project, "id" | "name" | "brand">, i: CreateWallInput): Wall {
  const name = i.name.trim().slice(0, NAME_MAX).trim();
  if (!name) throw new WallError(400, "Give the wall a name");
  const brand = parseBrand(project.brand).colors;
  const cfg = parseConfig(
    i.config ?? {
      hero: { title: `What people say about ${project.name}` },
      heroCta: { background: brand.button ?? "", color: brand.buttonText ?? "" },
    },
  );
  return getDb().transaction((tx) => {
    const slug = i.slug ? parseSlug(i.slug) : freeSlug(tx, project.id, slugify(name));
    if (i.slug) claimSlug(tx, project.id, slug);
    const now = new Date();
    return tx
      .insert(walls)
      .values({
        id: crypto.randomUUID(),
        projectId: project.id,
        slug,
        name,
        theme: parseWallTheme(i.theme),
        config: JSON.stringify(cfg),
        configVersion: cfg.v,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  });
}

export type WallPatch = {
  name?: string;
  theme?: WallTheme;
  published?: boolean;
  config?: WallConfigInput;
  featuredTestimonialId?: string | null;
  connectedFormId?: string | null;
};

function checkForm(projectId: string, formId: string | null | undefined): string | null {
  if (!formId) return null;
  const form = getDb().select().from(forms).where(eq(forms.id, formId)).get();
  if (!form || form.projectId !== projectId) throw new WallError(400, "Choose one of this project's forms");
  return form.id;
}

function checkTestimonial(projectId: string, id: string | null | undefined): string | null {
  if (!id) return null;
  const t = getDb().select({ projectId: testimonials.projectId }).from(testimonials).where(eq(testimonials.id, id)).get();
  if (!t || t.projectId !== projectId) throw new WallError(400, "Choose one of this project's testimonials");
  return id;
}

/** Replaces the config whole when `config` is given (the editor always sends all of it). */
export function updateWall(id: string, p: WallPatch): Wall | null {
  const w = getWall(id);
  if (!w) return null;
  const set: Partial<typeof walls.$inferInsert> = { updatedAt: new Date() };
  if (p.name !== undefined) set.name = p.name.trim().slice(0, NAME_MAX).trim() || w.name;
  if (p.theme !== undefined) {
    if (!(WALL_THEMES as readonly string[]).includes(p.theme)) throw new WallError(400, "Choose one of the themes");
    set.theme = p.theme;
  }
  if (p.published !== undefined) set.published = p.published;
  if (p.config !== undefined) {
    const cfg = parseConfig(p.config);
    set.config = JSON.stringify(cfg);
    set.configVersion = cfg.v;
  }
  if (p.featuredTestimonialId !== undefined) set.featuredTestimonialId = checkTestimonial(w.projectId, p.featuredTestimonialId);
  if (p.connectedFormId !== undefined) set.connectedFormId = checkForm(w.projectId, p.connectedFormId);
  return getDb().update(walls).set(set).where(eq(walls.id, id)).returning().get() ?? null;
}

/** A new link; the old slug keeps working as a 308 (D17). `droppedAlias` when the new slug was an old link of another wall. */
export function changeWallSlug(id: string, slug: string): { wall: Wall; droppedAlias: boolean } {
  const next = parseSlug(slug);
  return getDb().transaction((tx) => {
    const w = tx.select().from(walls).where(eq(walls.id, id)).get();
    if (!w) throw notFound();
    if (w.slug === next) return { wall: w, droppedAlias: false };
    const droppedAlias = claimSlug(tx, w.projectId, next, w.id);
    const now = new Date();
    tx.insert(slugRedirects)
      .values({ id: crypto.randomUUID(), kind: "wall", scope: w.projectId, projectId: w.projectId, wallId: w.id, oldSlug: w.slug, createdAt: now })
      .onConflictDoUpdate({
        target: [slugRedirects.kind, slugRedirects.scope, slugRedirects.oldSlug],
        set: { wallId: w.id, projectId: w.projectId, createdAt: now },
      })
      .run();
    return { wall: tx.update(walls).set({ slug: next, updatedAt: now }).where(eq(walls.id, id)).returning().get(), droppedAlias };
  });
}

/** Marks one wall as the project's main wall (or none, with null): /wall/<project> shows it while it's published. */
export function setMainWall(projectId: string, wallId: string | null): void {
  getDb().transaction((tx) => {
    if (wallId) {
      const w = tx.select().from(walls).where(and(eq(walls.id, wallId), eq(walls.projectId, projectId))).get();
      if (!w) throw notFound();
    }
    const now = new Date();
    // Clear first: the partial unique index allows one main wall per project.
    tx.update(walls)
      .set({ isMain: false, updatedAt: now })
      .where(and(eq(walls.projectId, projectId), eq(walls.isMain, true), ...(wallId ? [ne(walls.id, wallId)] : [])))
      .run();
    if (wallId) tx.update(walls).set({ isMain: true, updatedAt: now }).where(eq(walls.id, wallId)).run();
  });
}

/** Deletes the wall and its old links; its logo and cover go too unless something else uses them. */
export async function deleteWall(id: string): Promise<boolean> {
  const w = getWall(id);
  if (!w) return false;
  getDb().delete(walls).where(eq(walls.id, id)).run();
  const keys = [w.logoKey, w.coverKey].filter((k): k is string => Boolean(k) && !logoInUse(k!));
  if (keys.length) await removeFiles(keys);
  return true;
}

export const WALL_IMAGE_KINDS = ["cover", "logo"] as const;
export type WallImageKind = (typeof WALL_IMAGE_KINDS)[number];
const column = (kind: WallImageKind) => (kind === "cover" ? "coverKey" : "logoKey");

/** Stores a PNG, JPEG, WebP or GIF (never SVG) as the wall's cover or logo, replacing the old one. Public only while the wall is published. */
export async function setWallImage(id: string, kind: WallImageKind, file: File): Promise<Wall> {
  const w = getWall(id);
  if (!w) throw notFound();
  const stored = await saveUpload(file, "image");
  const updated = getDb()
    .update(walls)
    .set({ [column(kind)]: stored.key, updatedAt: new Date() })
    .where(eq(walls.id, id))
    .returning()
    .get();
  if (!updated) {
    await deleteObject(stored.key);
    throw notFound();
  }
  const old = w[column(kind)];
  if (old && old !== stored.key && !logoInUse(old)) await removeFiles([old]);
  return updated;
}

export async function removeWallImage(id: string, kind: WallImageKind): Promise<Wall> {
  const w = getWall(id);
  if (!w) throw notFound();
  const old = w[column(kind)];
  if (!old) return w;
  const updated = getDb()
    .update(walls)
    .set({ [column(kind)]: null, updatedAt: new Date() })
    .where(eq(walls.id, id))
    .returning()
    .get();
  if (!logoInUse(old)) await removeFiles([old]);
  return updated;
}

// ------------------------------------------------------------------ public view

/** The wall's own filters, narrowed to one tab's tag. */
function filtersFor(cfg: WallConfig, tag: string): PublicFilters {
  return {
    minRating: cfg.filters.minRating,
    type: cfg.filters.type,
    tags: tag ? [tag] : cfg.filters.tags,
    sort: cfg.filters.sort,
    max: 100,
  };
}

export type WallItems = { items: FeedItem[]; total: number; nextOffset: number | null };

/** One page of a tab's testimonials (public rows only), and how many there are in all. */
export function wallItems(wall: Pick<Wall, "projectId" | "config">, o: { tab?: number; offset?: number; limit?: number; config?: WallConfig } = {}): WallItems {
  const cfg = o.config ?? wallConfig(wall);
  const tabs = wallTabs(cfg);
  const tab = tabs[Math.max(0, Math.min(o.tab ?? 0, tabs.length - 1))];
  const filters = filtersFor(cfg, tab.tag);
  const offset = Math.max(0, Math.floor(o.offset ?? 0));
  const limit = Math.max(1, Math.min(o.limit ?? cfg.layout.pageSize, 48));
  const items = listFeed(wall.projectId, filters, { limit, offset });
  const total = feedAggregate(wall.projectId, filters).count;
  const next = offset + items.length;
  return { items, total, nextOffset: next < total && items.length ? next : null };
}

/** Everything WallView draws. Shared by the public pages and the editor preview (which passes an unsaved config). */
export type WallViewData = {
  wall: { id: string; name: string; slug: string; theme: WallTheme; config: WallConfig; logoUrl: string | null; coverUrl: string | null };
  project: { name: string; slug: string; accentColor: string };
  tabs: { label: string; tag: string }[];
  tab: number;
  items: FeedItem[];
  total: number;
  nextOffset: number | null;
  /** Every testimonial on the wall (all tabs): count and average rating. */
  stats: FeedAggregate;
  featured: FeedItem | null;
  /** Where the CTAs go when they have no link of their own. */
  formUrl: string;
  /** The page's path, for the tab links. */
  path: string;
};

type ViewWall = Pick<Wall, "id" | "name" | "slug" | "theme" | "logoKey" | "coverKey" | "featuredTestimonialId" | "connectedFormId" | "projectId" | "config">;

export function wallView(
  wall: ViewWall,
  project: Pick<Project, "id" | "name" | "slug" | "accentColor">,
  o: { tab?: string | string[] | null; path: string; config?: WallConfig },
): WallViewData {
  const cfg = o.config ?? wallConfig(wall);
  const tab = resolveTab(cfg, o.tab);
  const page = wallItems(wall, { tab, config: cfg });
  const featured =
    cfg.hero.showFeatured && wall.featuredTestimonialId
      ? (listFeed(project.id, {}, { mode: "manual", manualIds: [wall.featuredTestimonialId], limit: 1 })[0] ?? null)
      : null;
  const form = wall.connectedFormId ? getDb().select().from(forms).where(and(eq(forms.id, wall.connectedFormId), eq(forms.projectId, project.id))).get() : undefined;
  return {
    wall: {
      id: wall.id,
      name: wall.name,
      slug: wall.slug,
      theme: parseWallTheme(wall.theme),
      config: cfg,
      logoUrl: mediaUrl(wall.logoKey),
      coverUrl: mediaUrl(wall.coverKey),
    },
    project: { name: project.name, slug: project.slug, accentColor: project.accentColor },
    tabs: wallTabs(cfg),
    tab,
    ...page,
    stats: feedAggregate(project.id, filtersFor(cfg, "")),
    featured,
    formUrl: form ? formUrl(project, form) : `/c/${project.slug}`,
    path: o.path,
  };
}

/** The wall's public address: /wall/<project> for the main wall, else /wall/<project>/<wall>. */
export function wallPath(project: Pick<Project, "slug">, wall: Pick<Wall, "slug" | "isMain" | "published">): string {
  return wall.isMain && wall.published ? `/wall/${project.slug}` : `/wall/${project.slug}/${wall.slug}`;
}

/** WALL-03 / SEO-03: Review and AggregateRating data for the wall's testimonials. */
export function wallJsonLd(wall: Pick<Wall, "projectId" | "config">, project: Pick<Project, "id" | "name">, canonical: string) {
  const cfg = wallConfig(wall);
  const filters = filtersFor(cfg, "");
  return reviewJsonLd({
    type: cfg.seo.schemaType,
    name: cfg.seo.itemName || project.name,
    url: canonical,
    description: cfg.seo.description || cfg.hero.subtitle,
    items: listFeed(project.id, filters, { limit: 30 }),
    aggregate: ratingSummary(project.id, filters),
  });
}

/** The page title and description a wall shows search engines and link previews. */
export function wallSeoText(wall: Pick<Wall, "name" | "config">, project: Pick<Project, "name">) {
  const cfg = wallConfig(wall);
  return {
    title: cfg.seo.title || cfg.hero.title || `${wall.name} · ${project.name}`,
    description: cfg.seo.description || cfg.hero.subtitle || `What people say about ${project.name}.`,
    noindex: cfg.seo.noindex,
  };
}

/**
 * WALL-03: title, description, canonical (always the wall's public address,
 * without tab or other query), noindex, and link previews. `ogImage` is set
 * where the page has no opengraph-image file of its own (the main wall at
 * /wall/<project>).
 */
export function wallMetadata(
  wall: Pick<Wall, "name" | "config">,
  project: Pick<Project, "name">,
  o: { canonical: string; ogImage: string },
): Metadata {
  const seo = wallSeoText(wall, project);
  const url = absoluteUrl(o.canonical);
  const image = absoluteUrl(o.ogImage);
  return {
    metadataBase: new URL(env.publicUrl),
    title: { absolute: seo.title },
    description: seo.description,
    alternates: { canonical: url },
    robots: seo.noindex ? { index: false, follow: true } : undefined,
    openGraph: { type: "website", title: seo.title, description: seo.description, url, siteName: project.name, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: seo.title, description: seo.description, images: [image] },
  };
}

/** Absolute URL on this server (canonical links and OG images must be absolute). */
export function absoluteUrl(path: string): string {
  return `${env.publicUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}

// ------------------------------------------------------------------ admin

export function wallToAdmin(w: Wall, project: Pick<Project, "slug">) {
  return {
    id: w.id,
    projectId: w.projectId,
    name: w.name,
    slug: w.slug,
    published: w.published,
    isMain: w.isMain,
    theme: parseWallTheme(w.theme),
    config: wallConfig(w),
    logoUrl: mediaUrl(w.logoKey),
    coverUrl: mediaUrl(w.coverKey),
    featuredTestimonialId: w.featuredTestimonialId,
    connectedFormId: w.connectedFormId,
    /** Its own address (always works once published). */
    url: `/wall/${project.slug}/${w.slug}`,
    /** Where visitors see it (the project's wall address when it's the main wall). */
    publicUrl: wallPath(project, w),
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}
export type AdminWall = ReturnType<typeof wallToAdmin>;

export const createWallBody = z.object({
  name: z.string().trim().min(1, "Give the wall a name").max(NAME_MAX),
  slug: z.string().max(SLUG_MAX).optional(),
  theme: z.enum(WALL_THEMES).optional(),
});

export const wallPatchBody = z
  .object({
    name: z.string().trim().min(1, "Give the wall a name").max(NAME_MAX),
    theme: z.enum(WALL_THEMES),
    published: z.boolean(),
    config: z.record(z.string(), z.unknown()),
    featuredTestimonialId: z.string().max(64).nullable(),
    connectedFormId: z.string().max(64).nullable(),
  })
  .partial();

export const wallPreviewBody = z.object({
  theme: z.enum(WALL_THEMES).optional(),
  config: z.record(z.string(), z.unknown()),
  featuredTestimonialId: z.string().max(64).nullable().optional(),
  connectedFormId: z.string().max(64).nullable().optional(),
  tab: z.number().int().min(0).max(7).optional(),
});
