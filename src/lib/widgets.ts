import { randomInt } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Project, Widget, WidgetLayout } from "@/db/schema";
import { formUrl, getForm } from "./forms";
import {
  LAYOUTS,
  parseConfigLenient,
  PLACEMENTS,
  widgetConfigSchema,
  WIDGET_FONTS,
  type PublicWidget,
  type WidgetConfig,
  type WidgetConfigInput,
  type WidgetPayload,
} from "./widget-config";
import { feedAggregate, listFeed } from "./public-feed";
import { accentStyle } from "./theme";
import { firstIssue } from "./validation";

export * from "./widget-config";

const { widgets, forms } = schema;

/**
 * Saved widgets (DISP-01, DISP-12): a stored config the embed code points at
 * by id (`data-widget="w_…"`). Deleting is soft, so a deleted widget's embeds
 * show nothing instead of breaking the host page.
 */

export class WidgetError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const ID_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";
export const WIDGET_ID = /^w_[a-z0-9]{12}$/;

/** "w_" + 12 base36 characters. slugSchema forbids "_", so it never matches a project slug. */
export function newWidgetId(): string {
  let s = "w_";
  for (let i = 0; i < 12; i++) s += ID_CHARS[randomInt(36)];
  return s;
}

function json(raw: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function list(raw: string | null | undefined): unknown[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** The row's columns as one config. The options column also holds the CTA and rating summary settings. */
export function widgetConfig(w: Widget): WidgetConfig {
  const options = json(w.options);
  const { cta, aggregate, ...layoutOptions } = options;
  return parseConfigLenient({
    layout: w.layout,
    selection: { mode: w.selectionMode, manualIds: list(w.manualIds), pinnedIds: list(w.pinnedIds) },
    filters: json(w.filters),
    design: json(w.design),
    options: layoutOptions,
    labels: json(w.labels),
    cta,
    aggregate,
  });
}

function configColumns(cfg: WidgetConfig) {
  return {
    layout: cfg.layout,
    selectionMode: cfg.selection.mode,
    manualIds: JSON.stringify(cfg.selection.manualIds),
    pinnedIds: JSON.stringify(cfg.selection.pinnedIds),
    filters: JSON.stringify(cfg.filters),
    design: JSON.stringify(cfg.design),
    labels: JSON.stringify(cfg.labels),
    options: JSON.stringify({ ...cfg.options, cta: cfg.cta, aggregate: cfg.aggregate }),
    configVersion: cfg.v,
  };
}

function parseConfig(input: unknown): WidgetConfig {
  const parsed = widgetConfigSchema.safeParse(input);
  if (!parsed.success) throw new WidgetError(400, firstIssue(parsed.error));
  return parsed.data;
}

/** A connected form must belong to the widget's project. */
function checkForm(projectId: string, formId: string | null | undefined) {
  if (!formId) return null;
  const form = getForm(formId);
  if (!form || form.projectId !== projectId) throw new WidgetError(400, "Choose one of this project's forms");
  return form.id;
}

export function listWidgets(projectId: string): Widget[] {
  return getDb()
    .select()
    .from(widgets)
    .where(and(eq(widgets.projectId, projectId), isNull(widgets.deletedAt)))
    .orderBy(asc(widgets.createdAt), asc(widgets.id))
    .all();
}

/** Any widget by id, deleted ones too (null when there's no such id). */
export function getWidget(id: string): Widget | null {
  return getDb().select().from(widgets).where(eq(widgets.id, id)).get() ?? null;
}

/** A widget that hasn't been deleted. */
export function getLiveWidget(id: string): Widget | null {
  const w = getWidget(id);
  return w && !w.deletedAt ? w : null;
}

export type CreateWidgetInput = {
  name: string;
  layout: WidgetLayout;
  config?: Partial<WidgetConfigInput>;
  placement?: string | null;
  connectedFormId?: string | null;
};

export function createWidget(projectId: string, i: CreateWidgetInput): Widget {
  const cfg = parseConfig({ ...(i.config ?? {}), layout: i.layout });
  const connectedFormId = checkForm(projectId, i.connectedFormId);
  const now = new Date();
  const db = getDb();
  for (let attempt = 0; ; attempt++) {
    const id = newWidgetId();
    try {
      db.insert(widgets)
        .values({
          id,
          projectId,
          name: i.name.trim() || "Untitled widget",
          placement: i.placement ?? null,
          connectedFormId,
          ...configColumns(cfg),
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return getWidget(id)!;
    } catch (err) {
      // A clash in 36^12 ids is all but impossible; try again just in case.
      if (attempt < 3 && String(err).includes("UNIQUE")) continue;
      throw err;
    }
  }
}

export type WidgetPatch = {
  name?: string;
  placement?: string | null;
  connectedFormId?: string | null;
  config?: WidgetConfigInput;
};

/** Replaces the config whole when `config` is given (the studio always sends all of it). */
export function updateWidget(id: string, p: WidgetPatch): Widget | null {
  const w = getLiveWidget(id);
  if (!w) return null;
  const set: Partial<typeof widgets.$inferInsert> = { updatedAt: new Date() };
  if (p.name !== undefined) set.name = p.name.trim() || w.name;
  if (p.placement !== undefined) set.placement = p.placement || null;
  if (p.connectedFormId !== undefined) set.connectedFormId = checkForm(w.projectId, p.connectedFormId);
  if (p.config !== undefined) Object.assign(set, configColumns(parseConfig(p.config)));
  getDb().update(widgets).set(set).where(eq(widgets.id, id)).run();
  return getWidget(id);
}

export function duplicateWidget(id: string): Widget | null {
  const w = getLiveWidget(id);
  if (!w) return null;
  return createWidget(w.projectId, {
    name: `${w.name} (copy)`.slice(0, 120),
    layout: w.layout,
    config: widgetConfig(w),
    placement: w.placement,
    connectedFormId: w.connectedFormId,
  });
}

/** Soft delete: the feed then answers with an empty widget payload. */
export function deleteWidget(id: string): boolean {
  const w = getLiveWidget(id);
  if (!w) return false;
  getDb().update(widgets).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(widgets.id, id)).run();
  return true;
}

/** The connected form's hosted and iframe paths (widget.js makes them absolute against its own origin), while the form exists. */
export function ctaLinks(project: Pick<Project, "id" | "slug">, formId: string | null) {
  const db = getDb();
  const form = formId ? db.select().from(forms).where(and(eq(forms.id, formId), eq(forms.projectId, project.id))).get() : undefined;
  if (!form) return null;
  return {
    url: formUrl(project, form),
    embedUrl: `/embed/${project.slug}/form/${form.slug}`,
  };
}

/**
 * The display half of a widget for the public feed. A whitelist: filters,
 * picked ids, the form id and placement stay on the server, and no key
 * contains "email".
 */
export function toPublicWidget(
  w: Pick<Widget, "id">,
  cfg: WidgetConfig,
  ctx: { cta: { url: string; embedUrl: string } | null; wallUrl: string; projectAccent?: string },
): PublicWidget {
  const { font, firstNameOnly, ...design } = cfg.design;
  void firstNameOnly;
  const f = WIDGET_FONTS.find((x) => x.id === font) ?? WIDGET_FONTS[0];
  const accent = design.accent || ctx.projectAccent || "#0f766e";
  return {
    id: w.id,
    layout: cfg.layout,
    sort: cfg.filters.sort === "random" ? "random" : null,
    pinned: 0,
    design: { ...design, fontFamily: f.family, fontFile: f.file, accent, onAccent: accentStyle(accent)["--on-accent"] },
    options: { ...cfg.options },
    labels: { ...cfg.labels },
    cta: cfg.cta.enabled && ctx.cta ? { mode: cfg.cta.mode, url: ctx.cta.url, embedUrl: ctx.cta.embedUrl } : null,
    aggregate: { show: cfg.aggregate.show },
    wallUrl: ctx.wallUrl,
  };
}

/** The widget as the studio sees it (owner-only). */
export function widgetToAdmin(w: Widget) {
  return {
    id: w.id,
    projectId: w.projectId,
    name: w.name,
    layout: w.layout,
    placement: w.placement,
    connectedFormId: w.connectedFormId,
    config: widgetConfig(w),
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}
export type AdminWidget = ReturnType<typeof widgetToAdmin>;

/**
 * Everything widget.js needs to draw a widget: the public widget, its
 * testimonials and the rating summary. Shared by the public feed and the
 * studio preview (which passes an unsaved config), so the preview is the embed.
 */
export function widgetPayload(
  project: Pick<Project, "id" | "name" | "slug" | "accentColor">,
  w: Pick<Widget, "id" | "connectedFormId">,
  cfg: WidgetConfig,
): WidgetPayload {
  const sel = cfg.selection;
  const testimonials = listFeed(project.id, cfg.filters, {
    mode: sel.mode,
    manualIds: sel.manualIds,
    pinnedIds: sel.pinnedIds,
    limit: cfg.filters.max,
    firstNameOnly: cfg.design.firstNameOnly,
  });
  const aggregate = feedAggregate(project.id, cfg.filters, { scope: cfg.aggregate.scope, mode: sel.mode, manualIds: sel.manualIds });
  const widget = toPublicWidget(w, cfg, { cta: ctaLinks(project, w.connectedFormId), wallUrl: `/wall/${project.slug}`, projectAccent: project.accentColor });
  const pins = new Set(sel.pinnedIds);
  while (widget.pinned < testimonials.length && pins.has(testimonials[widget.pinned].id)) widget.pinned++;
  return {
    project: { name: project.name, slug: project.slug, accentColor: project.accentColor },
    widget,
    testimonials,
    aggregate,
  };
}

/** What the feed answers for a deleted widget: nothing to show, and nothing about the project. */
export const EMPTY_WIDGET_PAYLOAD: WidgetPayload = { project: null, widget: null, testimonials: [], aggregate: { count: 0, average: null } };

// ------------------------------------------------------------ admin API bodies

const placementBody = z.union([z.enum(PLACEMENTS), z.literal(""), z.null()]);

export const createWidgetBody = z.object({
  name: z.string().trim().min(1, "Give the widget a name").max(120),
  layout: z.enum(LAYOUTS).default("grid"),
  placement: placementBody.optional(),
  connectedFormId: z.string().max(64).nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const widgetPatchBody = z
  .object({
    name: z.string().trim().min(1, "Give the widget a name").max(120),
    placement: placementBody,
    connectedFormId: z.string().max(64).nullable(),
    config: z.record(z.string(), z.unknown()),
  })
  .partial();

export const previewBody = z.object({
  projectId: z.string().min(1).max(64),
  connectedFormId: z.string().max(64).nullable().optional(),
  config: z.record(z.string(), z.unknown()),
});
