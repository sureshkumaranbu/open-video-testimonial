import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Form, Project, Wall, Widget } from "@/db/schema";
import { env } from "./env";
import { getDefaultForm, updateForm, upgradeToSteps } from "./forms";
import { parseFormRow } from "./forms/schema";
import { getTemplate } from "./forms/templates";
import { sanitizeItem, startImport } from "./importers/run";
import { readSite, type SiteBrand, website } from "./importers/sources/website";
import { ImporterInputError, type PreviewItem } from "./importers/types";
import { normalizeEmail } from "./members";
import { downloadPublic, fetchPublicText, NetGuardError } from "./net-guard";
import { setPrefs } from "./notifications/prefs";
import { createProjectClaimingSlug, parseBrand, setProjectLogo, updateBrand } from "./projects";
import { getProjectById, updateProject } from "./testimonials";
import { createWall, setMainWall, updateWall } from "./walls";
import { createWidget, listWidgets } from "./widgets";

/**
 * Onboarding (ONB-01, ONB-03..06): the first-run wizard at /admin/welcome
 * makes a project from three answers, reads the owner's own site for its
 * brand and existing testimonials, creates starter assets (a step-by-step
 * default form, a main wall, a grid and a carousel widget) and keeps a "Get
 * started" checklist on the project. It never redirects /admin (D10).
 */

export const BUSINESS_TYPES = ["saas", "course", "coaching", "agency", "ecommerce", "local", "creator", "other"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
export const BUSINESS_LABELS: Record<BusinessType, string> = {
  saas: "Software (SaaS)",
  course: "Online course",
  coaching: "Coaching",
  agency: "Agency or services",
  ecommerce: "E-commerce",
  local: "Local business",
  creator: "Creator or newsletter",
  other: "Something else",
};
/** The form template each answer starts from (only the wording and questions differ). */
const TEMPLATE_FOR: Record<BusinessType, string | null> = {
  saas: "saas",
  course: "course",
  coaching: "coaching",
  agency: "agency",
  ecommerce: "ecommerce",
  local: "local",
  creator: null,
  other: null,
};

export const CHECKLIST_STEPS = ["collect", "widget", "install", "share"] as const;
export type ChecklistStepId = (typeof CHECKLIST_STEPS)[number];

const stepState = z.object({ done: z.boolean().optional(), skipped: z.boolean().optional() });
const onboardingSchema = z.object({
  answers: z.object({ businessType: z.string().max(40).optional(), website: z.string().max(500).optional() }).optional(),
  starter: z.object({ formId: z.string(), wallId: z.string(), widgetIds: z.array(z.string()) }).optional(),
  steps: z.partialRecord(z.enum(CHECKLIST_STEPS), stepState).default({}),
  dismissedAt: z.string().nullable().optional(),
  /** Set for projects made by the wizard: they show the checklist. */
  wizard: z.boolean().optional(),
});
export type OnboardingState = z.infer<typeof onboardingSchema>;

export function parseOnboarding(raw: string | null | undefined): OnboardingState {
  try {
    const parsed = onboardingSchema.safeParse(JSON.parse(raw || "{}"));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through
  }
  return { steps: {} };
}

function saveOnboarding(projectId: string, next: OnboardingState) {
  getDb().update(schema.projects).set({ onboarding: JSON.stringify(next) }).where(eq(schema.projects.id, projectId)).run();
}

export class OnboardingError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// ----------------------------------------------------------- the wizard

export const wizardBody = z.object({
  name: z.string().trim().min(1, "Give your project a name").max(80),
  website: z.string().trim().max(500).optional().default(""),
  businessType: z.enum(BUSINESS_TYPES).default("other"),
  /** The pre-ticked "Email me new testimonials" box (D14). */
  emailMe: z.boolean().default(false),
});
export type WizardInput = z.input<typeof wizardBody>;

function slugFrom(name: string) {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s.length >= 2 ? s : "project";
}

/** A free slug from the name: acme, acme-2, acme-3… */
function freeProjectSlug(name: string) {
  const base = slugFrom(name);
  for (let i = 1; i < 200; i++) {
    const slug = i === 1 ? base : `${base.slice(0, 36)}-${i}`;
    const taken = getDb().select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.slug, slug)).get();
    if (!taken) return slug;
  }
  return `${base.slice(0, 30)}-${crypto.randomBytes(3).toString("hex")}`;
}

export type Discovery = { runId: string | null; items: PreviewItem[]; brand: SiteBrand | null; error: string | null };

/**
 * The whole wizard in one call: the project, its brand and starter assets,
 * and (when a website was given) what we found there, ready to choose from.
 * A site that can't be read never stops the project being made: the error
 * comes back as a message.
 */
export async function runWizard(raw: WizardInput, o: { by: string }): Promise<{ project: Project; discovery: Discovery | null }> {
  const input = wizardBody.parse(raw);
  const { project: created } = createProjectClaimingSlug({ name: input.name, slug: freeProjectSlug(input.name) });
  let project = created;
  const site = input.website ? normalizeSite(input.website) : null;
  project = updateProject(project.id, { businessType: input.businessType, ...(site ? { website: site } : {}) }) ?? project;
  saveOnboarding(project.id, { ...parseOnboarding(project.onboarding), wizard: true, answers: { businessType: input.businessType, website: site ?? undefined } });

  let discovery: Discovery | null = null;
  if (input.website) discovery = await discover(project.id, input.website, { by: o.by });
  project = getProjectById(project.id)!;
  createStarterAssets(project, { businessType: input.businessType });

  if (input.emailMe) setPrefs(o.by, { newTestimonial: "instant" });
  setWelcome(o.by, "done");
  return { project: getProjectById(project.id)!, discovery };
}

function normalizeSite(raw: string) {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

let fetchOverride: typeof fetchPublicText | null = null;
/** Tests only: answer the site reads with this instead of the network. */
export function setOnboardingFetch(fn: typeof fetchPublicText | null) {
  fetchOverride = fn;
}

/**
 * Reads the site (ONB-02/03): brand first (colour and logo onto the project's
 * brand kit, silently skipped when missing), then the testimonials found,
 * kept on a previewed import run so "Import" brings in exactly what was shown.
 */
export async function discover(projectId: string, url: string, o: { by?: string } = {}): Promise<Discovery> {
  const project = getProjectById(projectId);
  if (!project) throw new OnboardingError(404, "Project not found");
  let page;
  try {
    page = await readSite(url, { fetchText: fetchOverride ?? fetchPublicText });
  } catch (err) {
    const message =
      err instanceof ImporterInputError || err instanceof NetGuardError
        ? err.message
        : `We couldn't read your site (${(err as Error).message.replace(/\.$/, "")}). You can import testimonials later.`;
    return { runId: null, items: [], brand: null, error: message };
  }
  await applyBrand(project, page.brand);

  const stored = page.items.map((r) => sanitizeItem(r, website)).filter((r): r is NonNullable<typeof r> => r !== null);
  const run = getDb()
    .insert(schema.taskRuns)
    .values({
      id: crypto.randomUUID(),
      projectId,
      kind: "import",
      subject: "website",
      input: JSON.stringify({ url: page.url }),
      // Found on the owner's own site: imported as approved (ONB-03), straight from this list.
      options: JSON.stringify({ minRating: null, skipEmpty: false, tags: [], status: "approved", fromUpload: true }),
      preview: JSON.stringify(stored),
      selection: '"all"',
      status: "previewed",
      total: stored.length,
      createdBy: o.by ?? null,
      createdAt: new Date(),
    })
    .returning()
    .get();
  const items: PreviewItem[] = stored.map((s) => ({
    id: s.sourceReviewId,
    authorName: s.authorName,
    authorTitle: s.authorTitle ?? null,
    authorCompany: s.authorCompany ?? null,
    avatarUrl: s.avatarUrl ?? null,
    rating: s.rating ?? null,
    headline: s.headline ?? null,
    text: s.text ?? null,
    url: s.url ?? null,
    date: s.date?.value ?? null,
    datePrecision: s.date?.precision ?? "day",
    language: s.language ?? null,
    videoUrl: null,
    platform: "website",
    alreadyImported: false,
  }));
  return { runId: run.id, items, brand: page.brand, error: null };
}

/** The scraped colour and logo onto the brand kit. Anything that fails is skipped: defaults stay. */
async function applyBrand(project: Project, brand: SiteBrand) {
  if (brand.color) {
    const kit = parseBrand(project.brand);
    try {
      updateBrand(project.id, { ...kit, colors: { ...kit.colors, primary: kit.colors.primary ?? brand.color, button: kit.colors.button ?? brand.color } });
    } catch {
      // A colour the brand kit refuses: keep the defaults.
    }
  }
  if (brand.logoUrl && !project.logoKey) {
    const dir = path.join(env.dataDir, "tmp");
    const file = path.join(dir, `logo-${crypto.randomUUID()}`);
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      // Never private addresses (whatever IMPORT_ALLOW_PRIVATE_URLS says for CSV media), and not for long.
      await downloadPublic(brand.logoUrl, file, 2 * 1024 * 1024, { allowPrivate: false, timeoutMs: 10_000 });
      const bytes = await fs.promises.readFile(file);
      // saveUpload sniffs the bytes and refuses anything that isn't PNG, JPEG, WebP or GIF.
      await setProjectLogo(project.id, new File([bytes], "logo", { type: "application/octet-stream" }));
    } catch {
      // No logo: the forms and walls show the project's initial.
    } finally {
      await fs.promises.rm(file, { force: true });
    }
  }
}

/** Imports the chosen found testimonials as approved, through the importer job. */
export function importDiscovered(projectId: string, runId: string, selection: "all" | string[]) {
  const run = getDb().select().from(schema.taskRuns).where(eq(schema.taskRuns.id, runId)).get();
  if (!run || run.projectId !== projectId || run.subject !== "website") throw new OnboardingError(404, "Nothing to import");
  return startImport(runId, selection, { projectId });
}

// ------------------------------------------------------------ starter assets

/**
 * ONB-04: the default form switched to step by step with the business type's
 * template, a published main wall, and a grid and a carousel widget, all in
 * the project's brand colour. Runs once per project.
 */
export function createStarterAssets(project: Project, i: { businessType: BusinessType; color?: string; logoKey?: string }): { form: Form; wall: Wall; widgets: Widget[] } {
  const state = parseOnboarding(project.onboarding);
  if (state.starter) {
    const form = getDb().select().from(schema.forms).where(eq(schema.forms.id, state.starter.formId)).get();
    const wall = getDb().select().from(schema.walls).where(eq(schema.walls.id, state.starter.wallId)).get();
    if (form && wall) return { form, wall, widgets: listWidgets(project.id).filter((w) => state.starter!.widgetIds.includes(w.id)) };
  }
  const kit = parseBrand(project.brand);
  const color = i.color ?? kit.colors.primary;
  if (i.color && !kit.colors.primary) updateBrand(project.id, { ...kit, colors: { ...kit.colors, primary: i.color, button: kit.colors.button ?? i.color } });
  const fresh = getProjectById(project.id)!;

  const steps = upgradeToSteps(getDefaultForm(project.id).id);
  const template = TEMPLATE_FOR[i.businessType] ? getTemplate(TEMPLATE_FOR[i.businessType]!) : null;
  const current = parseFormRow(steps);
  const base = template ? template.build(project.name) : current;
  const form =
    updateForm(steps.id, {
      pages: base.pages,
      labels: base.labels,
      settings: current.settings,
      design: { ...base.design, showLogo: true, ...(color ? { primary: color, button: color } : {}) },
    }) ?? steps;

  const wall = createWall(fresh, { name: "Wall of Love" });
  updateWall(wall.id, { published: true, connectedFormId: form.id });
  setMainWall(project.id, wall.id);

  const design = color ? { accent: color } : {};
  const widgets = [
    createWidget(project.id, { name: "Testimonial grid", layout: "grid", config: { design }, connectedFormId: form.id }),
    createWidget(project.id, { name: "Testimonial carousel", layout: "carousel", config: { design }, connectedFormId: form.id }),
  ];
  const latest = parseOnboarding(getProjectById(project.id)!.onboarding);
  saveOnboarding(project.id, { ...latest, starter: { formId: form.id, wallId: wall.id, widgetIds: widgets.map((w) => w.id) } });
  return { form, wall: getDb().select().from(schema.walls).where(eq(schema.walls.id, wall.id)).get()!, widgets };
}

// ---------------------------------------------------------------- checklist

export type ChecklistStep = { id: ChecklistStepId; done: boolean; skipped: boolean };
export type Checklist = { steps: ChecklistStep[]; dismissed: boolean; complete: boolean; doneCount: number; shown: boolean };

/**
 * ONB-05, live: ① collect is done once the project has a testimonial, ②
 * widget once one is created or changed beyond the starters, ③ install is
 * the owner's tick (install detection is P1), ④ share once an invite went
 * out or the owner copied the form link.
 */
export function checklistState(projectId: string): Checklist {
  const project = getProjectById(projectId);
  const state = parseOnboarding(project?.onboarding);
  const db = getDb();
  const live: Record<ChecklistStepId, boolean> = {
    collect:
      (db
        .select({ n: count() })
        .from(schema.testimonials)
        .where(and(eq(schema.testimonials.projectId, projectId), ne(schema.testimonials.status, "trashed")))
        .get()?.n ?? 0) > 0,
    widget: listWidgets(projectId).some((w) => !state.starter?.widgetIds.includes(w.id) || w.updatedAt.getTime() - w.createdAt.getTime() > 1000),
    install: false,
    share: (db.select({ n: count() }).from(schema.requests).where(eq(schema.requests.projectId, projectId)).get()?.n ?? 0) > 0,
  };
  const steps = CHECKLIST_STEPS.map((id) => ({ id, done: live[id] || Boolean(state.steps[id]?.done), skipped: !live[id] && Boolean(state.steps[id]?.skipped) && !state.steps[id]?.done }));
  const complete = steps.every((s) => s.done || s.skipped);
  const dismissed = Boolean(state.dismissedAt);
  return { steps, dismissed, complete, doneCount: steps.filter((s) => s.done).length, shown: Boolean(state.wizard || state.starter) && !dismissed };
}

export const checklistBody = z.union([
  z.object({ step: z.enum(CHECKLIST_STEPS), action: z.enum(["done", "skip", "undo"]) }),
  z.object({ dismiss: z.literal(true) }),
]);

export function updateChecklist(projectId: string, body: z.infer<typeof checklistBody>): Checklist {
  const project = getProjectById(projectId);
  if (!project) throw new OnboardingError(404, "Project not found");
  const state = parseOnboarding(project.onboarding);
  if ("dismiss" in body) {
    if (!checklistState(projectId).complete) throw new OnboardingError(409, "Finish or skip every step first");
    saveOnboarding(projectId, { ...state, dismissedAt: new Date().toISOString() });
  } else {
    const next = body.action === "done" ? { done: true } : body.action === "skip" ? { skipped: true } : {};
    saveOnboarding(projectId, { ...state, steps: { ...state.steps, [body.step]: next } });
  }
  return checklistState(projectId);
}

// ------------------------------------------------------- the welcome card

const { memberPrefs } = schema;

function readUi(email: string): Record<string, unknown> {
  const row = getDb().select({ ui: memberPrefs.ui }).from(memberPrefs).where(eq(memberPrefs.email, normalizeEmail(email))).get();
  try {
    const v: unknown = JSON.parse(row?.ui ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Whether this person finished or skipped the wizard (the dashboard's Get started card then goes). */
export function getWelcome(email: string): "done" | "skipped" | null {
  const v = readUi(email).welcome;
  return v === "done" || v === "skipped" ? v : null;
}

export function setWelcome(email: string, value: "done" | "skipped") {
  const key = normalizeEmail(email);
  const ui = JSON.stringify({ ...readUi(key), welcome: value });
  const now = new Date();
  getDb()
    .insert(memberPrefs)
    .values({ email: key, ui, updatedAt: now })
    .onConflictDoUpdate({ target: memberPrefs.email, set: { ui, updatedAt: now } })
    .run();
}

/** Nothing runs in the background for onboarding: discovery is one short request, imports use the importer job. */
export function registerOnboardingJobs(): void {}
