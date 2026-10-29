import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Form, Project, Wall, Widget } from "@/db/schema";
import { mergeSuggestion, suggestBrand } from "./brand-ai";
import { env } from "./env";
import { getDefaultForm, updateForm, upgradeToSteps } from "./forms";
import { parseFormRow } from "./forms/schema";
import { getTemplate } from "./forms/templates";
import { sanitizeItem, startImport } from "./importers/run";
import { readSite, type SiteBrand, type SitePage, website } from "./importers/sources/website";
import { ImporterInputError, type PreviewItem } from "./importers/types";
import { enqueue, registerJob } from "./jobs";
import { normalizeEmail } from "./members";
import { downloadPublic, fetchPublicText, NetGuardError } from "./net-guard";
import { setPrefs } from "./notifications/prefs";
import { createProjectClaimingSlug, parseBrand, setProjectLogo, updateBrand } from "./projects";
import { rateLimit } from "./rate-limit";
import { getRunProgress, type RunProgress } from "./runs";
import { getProjectById, updateProject } from "./testimonials";
import { createWall, setMainWall, updateWall, wallConfig } from "./walls";
import { createWidget, listWidgets, widgetConfig } from "./widgets";

/**
 * Onboarding (ONB-01..06): the first-run wizard at /admin/welcome makes a
 * project from three answers, creates starter assets (a step-by-step default
 * form, a main wall, a grid and a carousel widget), scans the owner's own
 * site in the background for its brand and existing testimonials, and keeps
 * a "Get started" checklist on the project. It never redirects /admin (D10).
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
  /** What the last brand scan found (ONB-02); the colour and logo themselves are on the brand kit. */
  found: z
    .object({
      siteName: z.string().max(80).optional(),
      color: z.string().max(7).optional(),
      logo: z.boolean().optional(),
      /** Whether the owner's AI provider answered (BRAND_AI_MODEL). */
      ai: z.boolean().optional(),
      at: z.string(),
    })
    .optional(),
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
 * The whole wizard in one call: the project and its starter assets, then
 * (when a website was given) the brand scan, started in the background. The
 * wizard follows the scan's run; the brand lands on the project whenever the
 * scan ends, even after the owner has moved on.
 */
export async function runWizard(raw: WizardInput, o: { by: string }): Promise<{ project: Project; scan: RunProgress | null }> {
  const input = wizardBody.parse(raw);
  const { project: created } = createProjectClaimingSlug({ name: input.name, slug: freeProjectSlug(input.name) });
  let project = created;
  const site = input.website ? normalizeSite(input.website) : null;
  project = updateProject(project.id, { businessType: input.businessType, ...(site ? { website: site } : {}) }) ?? project;
  saveOnboarding(project.id, { ...parseOnboarding(project.onboarding), wizard: true, answers: { businessType: input.businessType, website: site ?? undefined } });
  // Starter assets first, in the default look: the scan recolours them when it finds a colour.
  createStarterAssets(getProjectById(project.id)!, { businessType: input.businessType });
  const scan = input.website ? startDiscovery(project.id, input.website, { by: o.by }) : null;

  if (input.emailMe) setPrefs(o.by, { newTestimonial: "instant" });
  setWelcome(o.by, "done");
  return { project: getProjectById(project.id)!, scan };
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

// ------------------------------------------------------------ the brand scan

/**
 * ONB-02 (L10): the brand scan runs as a background job. Within 30 seconds
 * in all it reads robots.txt and the home page (net-guard: no private
 * addresses, 5 MB and 10 seconds at most each), takes the site name, theme
 * colour and logo from the page, optionally asks the owner's AI provider
 * (src/lib/brand-ai.ts), and puts the result on the project: colour and logo
 * on the brand kit and the starter assets, the name in the onboarding state,
 * and the testimonials found on a previewed import run (ONB-03). A site that
 * can't be read ends the scan quietly with the defaults kept; the reason is
 * kept for the wizard to show.
 */
export const BRAND_SCAN_JOB = "onboarding.brand-scan";
const SCAN_BUDGET_MS = 30_000;
const STEP_TIMEOUT_MS = 10_000;
const AI_TIMEOUT_MS = 15_000;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
/** Read the page; brand (logo download and AI step); save. The run's done/total. */
const SCAN_STEPS = 3;

/** What a finished scan keeps on its run (`preview`): exactly what the wizard shows. */
const scanResult = z.object({
  runId: z.string().nullable(),
  items: z.array(z.custom<PreviewItem>((v) => Boolean(v) && typeof v === "object")).max(50),
  brand: z.object({ name: z.string().optional(), color: z.string().optional(), logoUrl: z.string().optional() }).nullable(),
  error: z.string().nullable(),
});

/** Scans fetch someone else's site (and may call the AI provider): at most 30 an hour on this server. */
export function scanAllowed() {
  return rateLimit("onboarding-scan", 30, 60 * 60 * 1000);
}

/**
 * Starts a brand scan of `url` for the project, replacing any earlier scan
 * of it. Returns the run the dashboard follows (GET /api/admin/runs/[id]).
 */
export function startDiscovery(projectId: string, url: string, o: { by?: string } = {}): RunProgress {
  if (!getProjectById(projectId)) throw new OnboardingError(404, "Project not found");
  const db = getDb();
  const id = crypto.randomUUID();
  db.transaction((tx) => {
    tx.delete(schema.taskRuns).where(and(eq(schema.taskRuns.projectId, projectId), eq(schema.taskRuns.kind, "discover"))).run();
    tx.insert(schema.taskRuns)
      .values({ id, projectId, kind: "discover", subject: url.slice(0, 500), input: JSON.stringify({ url }), status: "queued", total: SCAN_STEPS, createdBy: o.by ?? null, createdAt: new Date() })
      .run();
    // One attempt: a scan that fails ends quietly, and the owner can scan again.
    const job = enqueue(BRAND_SCAN_JOB, { projectId, runId: id }, { maxAttempts: 1 });
    tx.update(schema.taskRuns).set({ jobId: job.id }).where(eq(schema.taskRuns.id, id)).run();
  });
  return getRunProgress(id)!;
}

/** A scan's progress and, once it has finished, what it found. Null when the project has no such scan. */
export function getDiscovery(projectId: string, runId: string): { run: RunProgress; discovery: Discovery | null } | null {
  const row = getDb().select().from(schema.taskRuns).where(eq(schema.taskRuns.id, runId)).get();
  if (!row || row.kind !== "discover" || row.projectId !== projectId) return null;
  const run = getRunProgress(runId)!;
  if (!run.finished) return { run, discovery: null };
  let parsed;
  try {
    parsed = scanResult.safeParse(JSON.parse(row.preview));
  } catch {
    parsed = null;
  }
  const discovery: Discovery = parsed?.success
    ? parsed.data
    : { runId: null, items: [], brand: null, error: "We couldn't read your site. You can import testimonials later." };
  return { run, discovery };
}

/** The job: one scan, start to end. Idempotent; a deleted project or finished run is left alone. */
export async function runBrandScan(p: { runId: string }): Promise<void> {
  const db = getDb();
  const t = schema.taskRuns;
  const row = db.select().from(t).where(eq(t.id, p.runId)).get();
  if (!row || row.kind !== "discover" || row.status === "done" || row.status === "failed" || !row.projectId) return;
  const projectId = row.projectId;
  const url = String((JSON.parse(row.input || "{}") as { url?: unknown }).url ?? "");
  db.update(t).set({ status: "running", done: 0 }).where(eq(t.id, row.id)).run();
  const step = (done: number) => db.update(t).set({ done }).where(and(eq(t.id, row.id), eq(t.status, "running"))).run();
  const end = (result: Discovery) =>
    db
      .update(t)
      .set({ status: "done", done: SCAN_STEPS, finishedAt: new Date(), preview: JSON.stringify(result), errors: JSON.stringify(result.error ? [result.error] : []) })
      .where(eq(t.id, row.id))
      .run();

  try {
    await scanSite(projectId, url, row.createdBy, end, step);
  } catch (err) {
    // Silent for the owner (the defaults stay); the reason is in the log.
    console.error(`[onboarding] brand scan ${row.id} failed: ${(err as Error).message}`);
    end({ runId: null, items: [], brand: null, error: "We couldn't read your site. You can import testimonials later." });
  }
}

async function scanSite(projectId: string, url: string, by: string | null, end: (r: Discovery) => void, step: (done: number) => void) {
  const db = getDb();
  const t = schema.taskRuns;
  const deadline = Date.now() + SCAN_BUDGET_MS;
  const left = (cap: number) => Math.max(0, Math.min(cap, deadline - Date.now()));
  const fetchText: typeof fetchPublicText = (u, o = {}) => {
    const timeoutMs = left(o.timeoutMs ?? STEP_TIMEOUT_MS);
    if (timeoutMs < 500) return Promise.reject(new Error("the 30 second limit was reached"));
    return (fetchOverride ?? fetchPublicText)(u, { ...o, timeoutMs });
  };

  let page: SitePage;
  try {
    page = await readSite(url, { fetchText });
  } catch (err) {
    const message =
      err instanceof ImporterInputError || err instanceof NetGuardError
        ? err.message
        : `We couldn't read your site (${(err as Error).message.replace(/\.$/, "")}). You can import testimonials later.`;
    end({ runId: null, items: [], brand: null, error: message });
    return;
  }
  step(1);
  let project = getProjectById(projectId);
  if (!project) return;

  // The logo download and the AI step share what's left of the 30 seconds.
  const [, ai] = await Promise.all([
    page.brand.logoUrl && !project.logoKey ? saveLogo(projectId, page.brand.logoUrl, left(STEP_TIMEOUT_MS)) : null,
    suggestBrand(page.html, page.url, { timeoutMs: left(AI_TIMEOUT_MS) }).catch(() => null),
  ]);
  const merged = mergeSuggestion(page.brand, page.items, ai);
  step(2);
  project = getProjectById(projectId);
  if (!project) return;
  applyBrandColor(project, merged.brand.color);
  applyBrandWords(projectId, merged.brand.name, merged.brand.description);
  const latest = parseOnboarding(getProjectById(projectId)!.onboarding);
  saveOnboarding(projectId, {
    ...latest,
    found: {
      siteName: merged.brand.name,
      color: merged.brand.color,
      logo: Boolean(getProjectById(projectId)!.logoKey),
      ai: ai !== null,
      at: new Date().toISOString(),
    },
  });

  const stored = merged.items.map((r) => sanitizeItem(r, website)).filter((r): r is NonNullable<typeof r> => r !== null);
  const importRun = db
    .insert(t)
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
      createdBy: by,
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
  end({ runId: importRun.id, items, brand: merged.brand, error: null });
}

/** Downloads the site's logo onto the project. Anything that fails is skipped: forms and walls show the initial. */
async function saveLogo(projectId: string, logoUrl: string, timeoutMs: number) {
  if (timeoutMs < 500) return;
  const dir = path.join(env.dataDir, "tmp");
  const file = path.join(dir, `logo-${crypto.randomUUID()}`);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    // Never private addresses (whatever IMPORT_ALLOW_PRIVATE_URLS says for CSV media), and not for long.
    await downloadPublic(logoUrl, file, LOGO_MAX_BYTES, { allowPrivate: false, timeoutMs });
    const bytes = await fs.promises.readFile(file);
    // The owner may have chosen a logo while the scan ran: theirs stays.
    if (getProjectById(projectId)?.logoKey) return;
    // saveUpload sniffs the bytes and refuses anything that isn't PNG, JPEG, WebP or GIF.
    await setProjectLogo(projectId, new File([bytes], "logo", { type: "application/octet-stream" }));
  } catch {
    // No logo: the defaults stay.
  } finally {
    await fs.promises.rm(file, { force: true });
  }
}

/**
 * The found colour onto the brand kit and the wizard's starter assets, where
 * none is set yet: a colour the owner chose always stays. The starter widgets
 * keep their updatedAt, so the checklist doesn't count this as customising one.
 */
/** The site's name and description go on the brand kit where it has none yet, to be edited there (Settings › Brand kit). */
function applyBrandWords(projectId: string, name: string | undefined, description: string | undefined) {
  const project = getProjectById(projectId);
  if (!project || (!name && !description)) return;
  const kit = parseBrand(project.brand);
  if ((kit.name || !name) && (kit.description || !description)) return;
  try {
    updateBrand(projectId, { ...kit, name: kit.name || name, description: kit.description || description });
  } catch {
    // Something the brand kit refuses: leave it empty.
  }
}

function applyBrandColor(project: Project, color: string | undefined) {
  if (!color) return;
  const kit = parseBrand(project.brand);
  try {
    updateBrand(project.id, { ...kit, colors: { ...kit.colors, primary: kit.colors.primary ?? color, button: kit.colors.button ?? color } });
  } catch {
    // A colour the brand kit refuses: keep the defaults.
    return;
  }
  const starter = parseOnboarding(project.onboarding).starter;
  if (!starter) return;
  const db = getDb();
  const form = db.select().from(schema.forms).where(eq(schema.forms.id, starter.formId)).get();
  if (form) {
    const { design } = parseFormRow(form);
    if (!design.primary) updateForm(form.id, { design: { ...design, primary: color, button: design.button ?? color } });
  }
  for (const w of listWidgets(project.id).filter((x) => starter.widgetIds.includes(x.id))) {
    const design = widgetConfig(w).design;
    if (!design.accent) db.update(schema.widgets).set({ design: JSON.stringify({ ...design, accent: color }) }).where(eq(schema.widgets.id, w.id)).run();
  }
  const wall = db.select().from(schema.walls).where(eq(schema.walls.id, starter.wallId)).get();
  if (wall) {
    const cfg = wallConfig(wall);
    if (!cfg.heroCta.background) updateWall(wall.id, { config: { ...cfg, heroCta: { ...cfg.heroCta, background: color } } });
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

/** The brand scan (ONB-02); importing what it found uses the importer job. */
export function registerOnboardingJobs(): void {
  registerJob(BRAND_SCAN_JOB, async (payload) => {
    await runBrandScan(payload as { runId: string });
  });
}
