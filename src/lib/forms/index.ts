import crypto from "node:crypto";
import { and, asc, count, desc, eq, ne, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/db";
import { FORM_STATUSES, type Form, type FormStatus, type Project, type Testimonial } from "@/db/schema";
import { removeFiles } from "@/lib/storage";
import { firstIssue, slugSchema } from "@/lib/validation";
import {
  classicCompatible,
  formConfigFromProject,
  legacyPatchToFormPatch,
  mirrorColumns,
  newFormConfig,
  nextAutoApproveSince,
  type LegacyFormPatch,
} from "./defaults";
import { LEGACY_FORM_FIELDS } from "./legacy";
import {
  autoApproveRuleSchema,
  formDesignSchema,
  formLabelsSchema,
  formPagesSchema,
  formSettingsSchema,
  parseFormRow,
  type AutoApproveRule,
  type FormConfig,
  type FormPatch,
} from "./schema";

/**
 * Forms: many per project, one of them the default (plan §2.4, §3.1). The
 * form row is the single source of truth; the project's legacy form columns
 * are a write-through mirror of the default form, written in the same
 * transaction (D2), so SettingsPanel, AutoApprovePanel, projectToApi and the
 * classic CollectForm keep reading them unchanged.
 */

const { forms, projects, testimonials, requests, slugRedirects, walls } = schema;

type Conn = Db | Tx;
type ConfigParts = Pick<FormConfig, "pages" | "design" | "labels" | "settings">;

/** Percent of invites answered, 0–100 and rounded; 0 when nothing was sent. */
export type FormStats = { submissions: number; invites: number; responded: number; responseRate: number };

/** A form change that was refused; `status` is what an API route answers with. */
export class FormError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class FormSlugTakenError extends FormError {
  constructor(slug: string) {
    super(409, `Another form in this project already uses “${slug}”. Pick a different link.`);
  }
}

const DEFAULT_SLUG = "default";
const DEFAULT_NAME = "Default form";
const NAME_MAX = 120;
const SLUG_MAX = 48;
const CLASSIC_ONLY =
  "The classic form can't show this. Switch the form to step-by-step first, then make the change.";

const configSchema = z.object({ pages: formPagesSchema, design: formDesignSchema, labels: formLabelsSchema, settings: formSettingsSchema });

/** Validates a config before it's stored, so every stored form parses. */
function checkConfig(parts: ConfigParts): ConfigParts {
  const parsed = configSchema.safeParse(parts);
  if (!parsed.success) throw new FormError(400, firstIssue(parsed.error));
  return parsed.data;
}

const configColumns = (c: ConfigParts) => ({
  pages: JSON.stringify(c.pages),
  design: JSON.stringify(c.design),
  labels: JSON.stringify(c.labels),
  settings: JSON.stringify(c.settings),
});

const projectRow = (db: Conn, id: string) => db.select().from(projects).where(eq(projects.id, id)).get() ?? null;
const defaultRow = (db: Conn, projectId: string) =>
  db.select().from(forms).where(and(eq(forms.projectId, projectId), eq(forms.isDefault, true))).get() ?? null;

/**
 * Fills in a row migration 0009 made (config_version 0) from the project's
 * columns, which is what the classic page showed until then. Idempotent: the
 * UPDATE only matches while the row is still at version 0.
 */
function hydrate(row: Form, db: Conn = getDb(), project?: Project): Form {
  if (row.configVersion !== 0) return row;
  const p = project ?? projectRow(db, row.projectId);
  if (!p) return row;
  db.update(forms)
    .set({ ...configColumns(formConfigFromProject(p)), configVersion: 1 })
    .where(and(eq(forms.id, row.id), eq(forms.configVersion, 0)))
    .run();
  return db.select().from(forms).where(eq(forms.id, row.id)).get() ?? row;
}

/** Writes the mirrored project columns that change for the default form's new config (D2). */
function writeMirror(db: Conn, projectId: string, cfg: FormConfig) {
  const project = projectRow(db, projectId);
  if (!project) return;
  const columns = mirrorColumns(project, cfg);
  if (Object.keys(columns).length) db.update(projects).set(columns).where(eq(projects.id, projectId)).run();
}

function parseSlug(raw: string): string {
  const parsed = slugSchema.safeParse(raw);
  if (!parsed.success) throw new FormError(400, firstIssue(parsed.error));
  return parsed.data;
}

/** A form name as a link: "Customer stories!" → "customer-stories". */
function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_MAX)
    .replace(/^-+|-+$/g, "");
  return slug.length >= 2 ? slug : "form";
}

/** `base`, or `base-2`, `base-3`…: the first that no form of the project uses, now or as an old link. */
function freeSlug(db: Conn, projectId: string, base: string): string {
  const taken = new Set([
    ...db.select({ slug: forms.slug }).from(forms).where(eq(forms.projectId, projectId)).all().map((r) => r.slug),
    ...db
      .select({ slug: slugRedirects.oldSlug })
      .from(slugRedirects)
      .where(and(eq(slugRedirects.kind, "form"), eq(slugRedirects.scope, projectId)))
      .all()
      .map((r) => r.slug),
  ]);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const slug = base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "") + suffix;
    if (!taken.has(slug)) return slug;
  }
}

/** Takes `slug` for a form of the project: refused when another form uses it; an old link with it is dropped (a live slug beats an alias, D17). */
function claimSlug(db: Conn, projectId: string, slug: string, formId?: string) {
  const live = db.select({ id: forms.id }).from(forms).where(and(eq(forms.projectId, projectId), eq(forms.slug, slug))).get();
  if (live && live.id !== formId) throw new FormSlugTakenError(slug);
  db.delete(slugRedirects)
    .where(and(eq(slugRedirects.kind, "form"), eq(slugRedirects.scope, projectId), eq(slugRedirects.oldSlug, slug)))
    .run();
}

function cleanName(name: string): string {
  const clean = name.trim().slice(0, NAME_MAX).trim();
  if (!clean) throw new FormError(400, "Give the form a name");
  return clean;
}

const notFound = () => new FormError(404, "Form not found");

// ------------------------------------------------------------------ reads

/** The project's forms, the default first, each with its submission and invite counts. */
export function listForms(projectId: string): (Form & { stats: FormStats })[] {
  const db = getDb();
  const rows = db
    .select()
    .from(forms)
    .where(eq(forms.projectId, projectId))
    .orderBy(desc(forms.isDefault), asc(forms.createdAt))
    .all()
    .map((f) => hydrate(f, db));
  const submissions = new Map(
    db
      .select({ formId: testimonials.formId, n: count() })
      .from(testimonials)
      .where(and(eq(testimonials.projectId, projectId), ne(testimonials.status, "trashed")))
      .groupBy(testimonials.formId)
      .all()
      .map((r) => [r.formId, r.n]),
  );
  const invites = new Map(
    db
      .select({ formId: requests.formId, n: count(), responded: count(requests.respondedAt) })
      .from(requests)
      .where(eq(requests.projectId, projectId))
      .groupBy(requests.formId)
      .all()
      .map((r) => [r.formId, r]),
  );
  return rows.map((f) => {
    // A request without a form opens the default one.
    const sent = [invites.get(f.id), f.isDefault ? invites.get(null) : undefined];
    const total = sent.reduce((n, r) => n + (r?.n ?? 0), 0);
    const responded = sent.reduce((n, r) => n + (r?.responded ?? 0), 0);
    return {
      ...f,
      stats: {
        submissions: submissions.get(f.id) ?? 0,
        invites: total,
        responded,
        responseRate: total ? Math.round((responded / total) * 100) : 0,
      },
    };
  });
}

export function getForm(id: string): Form | null {
  const db = getDb();
  const row = db.select().from(forms).where(eq(forms.id, id)).get();
  return row ? hydrate(row, db) : null;
}

/** Follows slug_redirects: `redirectedFrom` is the old slug when it did. */
export function getFormBySlug(projectId: string, slug: string): { form: Form; redirectedFrom?: string } | null {
  const db = getDb();
  const live = db.select().from(forms).where(and(eq(forms.projectId, projectId), eq(forms.slug, slug))).get();
  if (live) return { form: hydrate(live, db) };
  const alias = db
    .select({ formId: slugRedirects.formId })
    .from(slugRedirects)
    .where(and(eq(slugRedirects.kind, "form"), eq(slugRedirects.scope, projectId), eq(slugRedirects.oldSlug, slug)))
    .get();
  const form = alias?.formId
    ? db.select().from(forms).where(and(eq(forms.id, alias.formId), eq(forms.projectId, projectId))).get()
    : undefined;
  return form ? { form: hydrate(form, db), redirectedFrom: slug } : null;
}

/**
 * The project's default form, made if it has none: classic, from the
 * project's columns (createProject calls this in its transaction). Race-safe:
 * the insert does nothing when another default already exists (the partial
 * unique index), then the row is read back. A row migration 0009 made is
 * filled in here too, so every caller gets a usable config.
 */
export function ensureDefaultForm(project: Project, tx?: Tx): Form {
  const db: Conn = tx ?? getDb();
  const existing = defaultRow(db, project.id);
  if (existing) return hydrate(existing, db, project);
  const now = new Date();
  const insert = (slug: string) =>
    db
      .insert(forms)
      .values({
        id: crypto.randomUUID(),
        projectId: project.id,
        slug,
        name: DEFAULT_NAME,
        status: "live",
        layout: "classic",
        isDefault: true,
        configVersion: 1,
        ...configColumns(formConfigFromProject(project)),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  insert(DEFAULT_SLUG);
  // Nothing was added when another form of the project already has the "default" link.
  let form = defaultRow(db, project.id);
  if (!form) {
    insert(freeSlug(db, project.id, DEFAULT_SLUG));
    form = defaultRow(db, project.id);
  }
  if (!form) throw new Error(`Could not create the default form for project ${project.id}`);
  return hydrate(form, db, project);
}

/** The default form, filled in from the project columns the first time (config_version 0 → 1, idempotent). */
export function getDefaultForm(projectId: string): Form {
  const project = projectRow(getDb(), projectId);
  if (!project) throw new FormError(404, "Project not found");
  return ensureDefaultForm(project);
}

/**
 * The auto-approve rule for a testimonial: its form's, or the default form's
 * when it has none (or its form was deleted). Off when the project is gone.
 */
export function autoApproveRuleFor(t: Pick<Testimonial, "formId" | "projectId">): AutoApproveRule {
  const own = t.formId ? getForm(t.formId) : null;
  let form = own?.projectId === t.projectId ? own : null;
  if (!form) {
    const project = projectRow(getDb(), t.projectId);
    form = project && ensureDefaultForm(project);
  }
  return form ? parseFormRow(form).settings.autoApprove : autoApproveRuleSchema.parse({});
}

/** A classic default form lives at /c/<project>; everything else at /f/<project>/<form>. A path: callers add env.publicUrl. */
export function formUrl(project: Pick<Project, "slug">, form: Pick<Form, "slug" | "isDefault" | "layout">): string {
  return form.isDefault && form.layout === "classic" ? `/c/${project.slug}` : `/f/${project.slug}/${form.slug}`;
}

// ----------------------------------------------------------------- writes

/**
 * A new form, step by step (D1). It starts from the project's question and
 * wording with every rule off (newFormConfig); `config` replaces parts of
 * that, e.g. with a template's build() (WP2.2), and `template` records which.
 * The project gets its default form first if it has none.
 */
export function createForm(
  projectId: string,
  i: { name: string; slug?: string; template?: string; config?: Partial<ConfigParts> },
): Form {
  const project = projectRow(getDb(), projectId);
  if (!project) throw new FormError(404, "Project not found");
  const name = cleanName(i.name);
  const slug = i.slug === undefined ? undefined : parseSlug(i.slug);
  const base = newFormConfig(project);
  const cfg = checkConfig({
    pages: i.config?.pages ?? base.pages,
    design: i.config?.design ?? base.design,
    labels: i.config?.labels ?? base.labels,
    settings: i.config?.settings ?? base.settings,
  });
  // A form starts with its rule off; one passed in on applies from now.
  cfg.settings.autoApprove.since = nextAutoApproveSince(autoApproveRuleSchema.parse({}), cfg.settings.autoApprove);
  ensureDefaultForm(project);
  return getDb().transaction((tx) => {
    if (slug) claimSlug(tx, projectId, slug);
    const now = new Date();
    return tx
      .insert(forms)
      .values({
        id: crypto.randomUUID(),
        projectId,
        slug: slug ?? freeSlug(tx, projectId, slugify(name)),
        name,
        status: "live",
        layout: "steps",
        isDefault: false,
        configVersion: 1,
        ...configColumns(cfg),
        language: "en",
        template: i.template ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  });
}

/**
 * Saves the builder's changes. Each part given replaces that part whole. On the
 * default form it also rewrites the mirrored project columns, in the same
 * transaction. `autoApprove.since` is bookkeeping, never taken from the patch:
 * turning a rule on starts it now, turning it off clears it. A classic form
 * refuses a change CollectForm can't show (FormError 409: switch to
 * step-by-step first). `logoKey` is stored as given; the caller deletes a
 * replaced file. `o.by` is who saved it (the session email), kept for the log.
 */
export function updateForm(id: string, patch: FormPatch, o?: { by?: string }): Form | null {
  const row = getForm(id);
  if (!row) return null;
  const before = parseFormRow(row);
  const after = checkConfig({
    pages: patch.pages ?? before.pages,
    design: patch.design ?? before.design,
    labels: patch.labels ?? before.labels,
    settings: patch.settings ?? before.settings,
  });
  after.settings.autoApprove.since = nextAutoApproveSince(before.settings.autoApprove, after.settings.autoApprove);
  const language = patch.language?.trim().slice(0, 16) || row.language;
  const name = patch.name === undefined ? row.name : cleanName(patch.name);
  const cfg: FormConfig = { v: 1, layout: row.layout, ...after };
  if (row.layout === "classic" && !classicCompatible(cfg, language)) throw new FormError(409, CLASSIC_ONLY);
  return getDb().transaction((tx) => {
    const form = tx
      .update(forms)
      .set({
        ...configColumns(after),
        name,
        ...(patch.logoKey !== undefined ? { logoKey: patch.logoKey } : {}),
        language,
        configVersion: 1,
        updatedAt: new Date(),
      })
      .where(eq(forms.id, id))
      .returning()
      .get();
    if (form?.isDefault) writeMirror(tx, form.projectId, cfg);
    return form ?? null;
  });
}

/**
 * updateProject's half of the mirror (D2): applies a SettingsPanel or
 * AutoApprovePanel PATCH to the default form (made and filled in first if
 * need be), then writes the project's mirrored columns, all in one
 * transaction (`tx` when given). Values the PATCH sets are stored as sent
 * whenever the form reads them the same way, so the panel shows exactly what
 * was saved. Returns the updated project; other columns are the caller's.
 */
export function applyLegacyPatch(project: Project, patch: LegacyFormPatch, tx?: Tx): Project {
  const literal = Object.fromEntries(
    LEGACY_FORM_FIELDS.filter((k) => patch[k] !== undefined).map((k) => [k, patch[k]]),
  ) as LegacyFormPatch;
  if (!Object.keys(literal).length) return project;
  const apply = (t: Tx) => {
    const form = ensureDefaultForm(project, t);
    const cfg = legacyPatchToFormPatch(literal, parseFormRow(form));
    t.update(forms).set({ ...configColumns(cfg), updatedAt: new Date() }).where(eq(forms.id, form.id)).run();
    const columns = { ...literal, ...mirrorColumns({ ...project, ...literal }, cfg) };
    return t.update(projects).set(columns).where(eq(projects.id, project.id)).returning().get() ?? project;
  };
  return tx ? apply(tx) : getDb().transaction(apply);
}

/** A copy named "<name> (copy)" with its own link. Copies are never the default, so they're step by step (D1). */
export function duplicateForm(id: string): Form | null {
  const src = getForm(id);
  if (!src) return null;
  return getDb().transaction((tx) => {
    const now = new Date();
    return tx
      .insert(forms)
      .values({
        id: crypto.randomUUID(),
        projectId: src.projectId,
        slug: freeSlug(tx, src.projectId, slugify(`${src.slug}-copy`)),
        name: `${src.name.slice(0, NAME_MAX - 7)} (copy)`,
        status: src.status,
        layout: "steps",
        isDefault: false,
        configVersion: 1,
        pages: src.pages,
        design: src.design,
        labels: src.labels,
        settings: src.settings,
        reward: src.reward,
        language: src.language,
        logoKey: src.logoKey,
        template: src.template,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  });
}

/** Whether a stored file is still used as a logo or cover somewhere, so a deleted form's (possibly shared) logo is only removed when it was the last. */
export function logoInUse(key: string, db: Conn = getDb()): boolean {
  const used = (n: { n: number } | undefined) => (n?.n ?? 0) > 0;
  return (
    used(db.select({ n: count() }).from(forms).where(eq(forms.logoKey, key)).get()) ||
    used(db.select({ n: count() }).from(projects).where(eq(projects.logoKey, key)).get()) ||
    used(db.select({ n: count() }).from(walls).where(or(eq(walls.logoKey, key), eq(walls.coverKey, key))).get())
  );
}

/**
 * Refuses the default form (FormError 409). Its testimonials and requests
 * keep their rows (form_id becomes NULL; a request then opens the default
 * form), its form-scoped webhooks and old links go with it, and its logo is
 * deleted unless something else still uses the file.
 */
export async function deleteForm(id: string): Promise<boolean> {
  const db = getDb();
  const form = db.select().from(forms).where(eq(forms.id, id)).get();
  if (!form) return false;
  if (form.isDefault) throw new FormError(409, "The default form can't be deleted. Make another form the default first.");
  db.delete(forms).where(and(eq(forms.id, id), eq(forms.isDefault, false))).run();
  if (form.logoKey && !logoInUse(form.logoKey, db)) await removeFiles([form.logoKey]);
  return true;
}

/** Makes another of the project's forms the default; the project's mirrored columns then follow it. */
export function setDefaultForm(projectId: string, formId: string): void {
  getDb().transaction((tx) => {
    const project = projectRow(tx, projectId);
    const row = tx.select().from(forms).where(and(eq(forms.id, formId), eq(forms.projectId, projectId))).get();
    if (!project || !row) throw notFound();
    if (row.isDefault) return;
    // The old default keeps the config it had, filled in if it never was.
    const old = defaultRow(tx, projectId);
    if (old) hydrate(old, tx, project);
    const form = hydrate(row, tx, project);
    const now = new Date();
    tx.update(forms).set({ isDefault: false, updatedAt: now }).where(and(eq(forms.projectId, projectId), eq(forms.isDefault, true))).run();
    tx.update(forms).set({ isDefault: true, updatedAt: now }).where(eq(forms.id, formId)).run();
    writeMirror(tx, projectId, parseFormRow(form));
  });
}

/** Writes a slug_redirects row for the old slug, so its links keep working. */
export function changeFormSlug(id: string, slug: string): Form {
  const next = parseSlug(slug);
  return getDb().transaction((tx) => {
    const row = tx.select().from(forms).where(eq(forms.id, id)).get();
    if (!row) throw notFound();
    const form = hydrate(row, tx);
    if (form.slug === next) return form;
    claimSlug(tx, form.projectId, next, form.id);
    const now = new Date();
    tx.insert(slugRedirects)
      .values({ id: crypto.randomUUID(), kind: "form", scope: form.projectId, projectId: form.projectId, formId: form.id, oldSlug: form.slug, createdAt: now })
      .onConflictDoUpdate({
        target: [slugRedirects.kind, slugRedirects.scope, slugRedirects.oldSlug],
        set: { formId: form.id, projectId: form.projectId, createdAt: now },
      })
      .run();
    return tx.update(forms).set({ slug: next, updatedAt: now }).where(eq(forms.id, id)).returning().get();
  });
}

/** Live or paused; a paused form shows its closed message instead. */
export function setFormStatus(id: string, s: FormStatus): Form {
  if (!FORM_STATUSES.includes(s)) throw new FormError(400, "Status must be live or paused");
  if (!getForm(id)) throw notFound();
  return getDb().update(forms).set({ status: s, updatedAt: new Date() }).where(eq(forms.id, id)).returning().get();
}

/** classic → steps (D1); the config is kept. /c/<project> then sends visitors on to /f/<project>/<form>. */
export function upgradeToSteps(id: string): Form {
  const form = getForm(id);
  if (!form) throw notFound();
  if (form.layout === "steps") return form;
  return getDb().update(forms).set({ layout: "steps", updatedAt: new Date() }).where(eq(forms.id, id)).returning().get();
}
