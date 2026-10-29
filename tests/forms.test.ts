import crypto from "node:crypto";
import fs from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db";
import type { Form, Project } from "@/db/schema";
import {
  classicCompatible,
  formConfigFromProject,
  legacyPatchToFormPatch,
  mirrorColumns,
  primaryQuestion,
  projectColumnsFromForm,
} from "@/lib/forms/defaults";
import {
  applyLegacyPatch,
  autoApproveRuleFor,
  changeFormSlug,
  createForm,
  deleteForm,
  duplicateForm,
  ensureDefaultForm,
  FormError,
  FormSlugTakenError,
  formUrl,
  getDefaultForm,
  getForm,
  getFormBySlug,
  listForms,
  setDefaultForm,
  setFormStatus,
  updateForm,
  upgradeToSteps,
} from "@/lib/forms";
import { DEFAULT_PROMPT, DEFAULT_QUESTIONS, DEFAULT_THANK_YOU, LEGACY_FORM_FIELDS, resolveQuestions } from "@/lib/forms/legacy";
import {
  formPagesSchema,
  parseFormRow,
  toPublicForm,
  type FormConfig,
  type FormPage,
  type QuestionPage,
} from "@/lib/forms/schema";
import { createRequests } from "@/lib/requests";
import { resolveKey, saveUpload } from "@/lib/storage";
import * as testimonialsLib from "@/lib/testimonials";
import { createProject, createTestimonial, getProjectById } from "@/lib/testimonials";
import { PNG_BYTES, useTempDataDir } from "./helpers";

/**
 * Forms core (plan §2.4, §3.1): the default form, the classic layout and the
 * write-through mirror of the project's legacy form columns (D1–D3).
 */

const { forms, projects, slugRedirects, testimonials } = schema;

let ctx: ReturnType<typeof useTempDataDir>;
let project: Project;

/** A project with no forms yet, whether or not createProject makes the default form itself (WP1.3). */
function bareProject(input: Parameters<typeof createProject>[0]) {
  const p = createProject(input);
  getDb().delete(forms).where(eq(forms.projectId, p.id)).run();
  return p;
}

beforeEach(() => {
  ctx = useTempDataDir();
  project = bareProject({ name: "Acme", slug: "acme" });
});
afterEach(() => {
  vi.restoreAllMocks();
  ctx.cleanup();
});

const SINCE = new Date("2026-03-04T05:06:07.089Z");
const reload = () => getProjectById(project.id)!;
const formRows = () => getDb().select().from(forms).where(eq(forms.projectId, project.id)).all();
const cfgOf = (f: Form) => parseFormRow(f);
const q1 = (cfg: Pick<FormConfig, "pages">) => primaryQuestion(cfg)!;
const page = <T extends FormPage["type"]>(cfg: Pick<FormConfig, "pages">, type: T) =>
  cfg.pages.find((p) => p.type === type) as Extract<FormPage, { type: T }>;

/** A project with every legacy form column set away from its default. */
function customProject(): Project {
  const db = getDb();
  return db
    .update(projects)
    .set({
      prompt: "What did Acme change for you?",
      questions: "Before?\nAfter?",
      allowVideo: true,
      allowText: false,
      maxVideoSeconds: 90,
      consentText: "I agree {project} may quote me.",
      thankYouMessage: "Thanks a lot!",
      thankYouEmail: false,
      accentColor: "#7c3aed",
      autoApprove: true,
      autoApproveMinRating: 5,
      autoApproveVideo: true,
      autoApproveSince: SINCE,
    })
    .where(eq(projects.id, project.id))
    .returning()
    .get();
}

/** A row exactly as migration 0009 makes it (classic, default, config_version 0, empty JSON), in place of any forms the project has. */
function migratedDefaultForm(projectId = project.id) {
  getDb().delete(forms).where(eq(forms.projectId, projectId)).run();
  return getDb()
    .insert(forms)
    .values({ id: crypto.randomUUID(), projectId, slug: "default", name: "Default form", layout: "classic", isDefault: true, configVersion: 0 })
    .returning()
    .get();
}

/** A second question (optional, text only) added to a config. */
function withSecondQuestion(cfg: FormConfig): FormPage[] {
  const at = cfg.pages.findIndex((p) => p.type === "question") + 1;
  const extra = formPagesSchema.element.parse({ type: "question", key: "q2", required: false, title: "Anything else?", mode: "text" });
  return [...cfg.pages.slice(0, at), extra, ...cfg.pages.slice(at)];
}

// ----------------------------------------------------------------- legacy

describe("legacy constants", () => {
  it("match testimonials.ts until it re-exports them", () => {
    expect(DEFAULT_QUESTIONS).toEqual(testimonialsLib.DEFAULT_QUESTIONS);
    expect(DEFAULT_PROMPT).toBe(testimonialsLib.DEFAULT_PROMPT);
    for (const questions of ["", "  \n ", "One\n\n Two ", "Only"]) {
      expect(resolveQuestions({ questions })).toEqual(testimonialsLib.projectQuestions({ questions }));
    }
  });
});

// ------------------------------------------------------- default config

describe("formConfigFromProject", () => {
  it("describes today's classic page", () => {
    const p = customProject();
    const cfg = formConfigFromProject(p);
    expect(cfg.layout).toBe("classic");
    expect(cfg.pages.map((x) => x.type)).toEqual(["rating", "welcome", "question", "consent", "about_you", "review", "thank_you"]);
    expect(page(cfg, "rating")).toMatchObject({ enabled: true, required: false });
    expect(page(cfg, "welcome").enabled).toBe(false);
    expect(page(cfg, "review").enabled).toBe(false);
    expect(q1(cfg)).toMatchObject({
      key: "q1",
      enabled: true,
      primary: true,
      required: true,
      title: "What did Acme change for you?",
      tips: ["Before?", "After?"],
      mode: "video",
      maxVideoSeconds: 90,
    });
    expect(page(cfg, "consent")).toEqual({ type: "consent", text: "I agree {project} may quote me.", scopes: ["social"], allowPrivate: false });
    const about = page(cfg, "about_you");
    expect(about.custom).toEqual([]);
    expect(Object.fromEntries(Object.entries(about.fields).map(([k, f]) => [k, f.enabled]))).toEqual({
      email: true,
      photo: true,
      title: true,
      company: true,
      website: false,
      phone: false,
      socials: false,
    });
    expect(Object.values(about.fields).every((f) => !f.required)).toBe(true);
    expect(page(cfg, "thank_you").message).toBe("Thanks a lot!");
    expect(cfg.design.primary).toBe("#7c3aed");
    expect(cfg.settings.autoApprove).toEqual({ mode: "rating", minRating: 5, includeVideo: true, since: SINCE });
    expect(cfg.settings.confirmationEmail.enabled).toBe(false);
  });

  it("uses DEFAULT_QUESTIONS for empty questions and keeps empty consent wording empty (the default)", () => {
    const p = getDb().update(projects).set({ questions: "", consentText: "" }).where(eq(projects.id, project.id)).returning().get();
    const cfg = formConfigFromProject(p);
    expect(q1(cfg).tips).toEqual(DEFAULT_QUESTIONS);
    expect(page(cfg, "consent").text).toBe("");
  });

  it("maps the two answer columns to one mode", () => {
    const mode = (allowVideo: boolean, allowText: boolean) => q1(formConfigFromProject({ ...project, allowVideo, allowText })).mode;
    expect(mode(true, true)).toBe("video_text");
    expect(mode(true, false)).toBe("video");
    expect(mode(false, true)).toBe("text");
    expect(mode(false, false)).toBe("video_text");
  });

  it("always gives pages the schema accepts, whatever the columns hold", () => {
    const odd: Project = {
      ...project,
      prompt: "   ",
      questions: Array.from({ length: 12 }, (_, i) => `Tip ${i} ${"x".repeat(300)}`).join("\n"),
      maxVideoSeconds: 9000,
      consentText: "c".repeat(1500),
      thankYouMessage: "",
      accentColor: "teal",
      autoApproveMinRating: 9,
    };
    const cfg = formConfigFromProject(odd);
    expect(formPagesSchema.safeParse(cfg.pages).success).toBe(true);
    expect(q1(cfg).title).toBe(DEFAULT_PROMPT);
    expect(q1(cfg).tips).toHaveLength(8);
    expect(q1(cfg).tips.every((t) => t.length <= 200)).toBe(true);
    expect(q1(cfg).maxVideoSeconds).toBe(600);
    expect(cfg.design.primary).toBeUndefined();
    expect(cfg.settings.autoApprove.minRating).toBe(5);
  });
});

// ----------------------------------------------------------------- mirror

describe("the mirror (D2, D3)", () => {
  it("round-trips every legacy column, autoApproveSince to the millisecond", () => {
    const p = customProject();
    const columns = projectColumnsFromForm(formConfigFromProject(p));
    expect(Object.keys(columns).sort()).toEqual([...LEGACY_FORM_FIELDS].sort());
    for (const k of LEGACY_FORM_FIELDS) expect(columns[k], k).toEqual(p[k]);
    expect((columns.autoApproveSince as Date).getTime()).toBe(SINCE.getTime());
    // A project as createProject makes it, too.
    const fresh = projectColumnsFromForm(formConfigFromProject(project));
    for (const k of LEGACY_FORM_FIELDS) expect(fresh[k], k).toEqual(project[k]);
  });

  it("shows rules the columns can't hold as on, with the minimum clamped to 4 or 5 (D3)", () => {
    const cfg = formConfigFromProject(customProject());
    const columns = (rule: Partial<FormConfig["settings"]["autoApprove"]>) =>
      projectColumnsFromForm({ ...cfg, settings: { ...cfg.settings, autoApprove: { ...cfg.settings.autoApprove, ...rule } } });
    for (const mode of ["all", "text", "public"] as const) {
      expect(columns({ mode, minRating: 1 })).toMatchObject({ autoApprove: true, autoApproveMinRating: 4 });
    }
    expect(columns({ mode: "rating", minRating: 2 })).toMatchObject({ autoApprove: true, autoApproveMinRating: 4 });
    expect(columns({ mode: "rating", minRating: 4 })).toMatchObject({ autoApprove: true, autoApproveMinRating: 4 });
    expect(columns({ mode: "rating", minRating: 5 })).toMatchObject({ autoApprove: true, autoApproveMinRating: 5 });
    expect(columns({ mode: "off", minRating: 3, since: null })).toMatchObject({ autoApprove: false, autoApproveMinRating: 4, autoApproveSince: null });
  });

  it("keeps stored values that describe the same form", () => {
    const p = { ...customProject(), questions: "", allowVideo: false, allowText: false };
    const cfg = formConfigFromProject(p);
    expect(mirrorColumns(p, cfg)).toEqual({});
    const edited = structuredClone(cfg);
    q1(edited).title = "A new question?";
    expect(mirrorColumns(p, edited)).toEqual({ prompt: "A new question?" });
    q1(edited).mode = "text";
    expect(mirrorColumns(p, edited)).toEqual({ prompt: "A new question?", allowVideo: false, allowText: true });
  });

  it("clearing the thank-you message puts the default wording in the column", () => {
    const p = customProject();
    const cleared = structuredClone(formConfigFromProject(p));
    page(cleared, "thank_you").message = "";
    expect(mirrorColumns(p, cleared)).toEqual({ thankYouMessage: DEFAULT_THANK_YOU });
    expect(mirrorColumns({ ...p, thankYouMessage: DEFAULT_THANK_YOU }, cleared)).toEqual({});
  });
});

describe("legacyPatchToFormPatch", () => {
  const NOW = new Date("2026-10-25T12:00:00Z");

  it("applies a SettingsPanel save to the main question, consent, thank-you, design and email", () => {
    const cfg = formConfigFromProject(project);
    const next = legacyPatchToFormPatch(
      {
        prompt: "How did we do?",
        questions: "",
        allowVideo: false,
        maxVideoSeconds: 45,
        consentText: "Quote me, {project}.",
        thankYouMessage: "Cheers!",
        thankYouEmail: false,
        accentColor: "#112233",
      },
      cfg,
      NOW,
    );
    expect(q1(next)).toMatchObject({ title: "How did we do?", tips: DEFAULT_QUESTIONS, mode: "text", maxVideoSeconds: 45 });
    expect(page(next, "consent").text).toBe("Quote me, {project}.");
    expect(page(next, "thank_you").message).toBe("Cheers!");
    expect(next.design.primary).toBe("#112233");
    expect(next.settings.confirmationEmail.enabled).toBe(false);
    // The input is left alone.
    expect(q1(cfg).title).toBe(project.prompt);
  });

  it("starts auto-approve now, keeps the date while it stays on, and clears it when off", () => {
    const off = formConfigFromProject(project);
    const on = legacyPatchToFormPatch({ autoApprove: true }, off, NOW);
    expect(on.settings.autoApprove).toMatchObject({ mode: "rating", since: NOW });
    const later = new Date(NOW.getTime() + 60_000);
    expect(legacyPatchToFormPatch({ autoApprove: true, autoApproveMinRating: 5 }, on, later).settings.autoApprove).toMatchObject({
      mode: "rating",
      minRating: 5,
      since: NOW,
    });
    expect(legacyPatchToFormPatch({ autoApprove: false }, on, later).settings.autoApprove).toMatchObject({ mode: "off", since: null });
  });

  it("leaves a builder-only rule alone when the panel sends back what it shows (D3)", () => {
    const base = formConfigFromProject(project);
    const custom: FormConfig = {
      ...base,
      settings: { ...base.settings, autoApprove: { mode: "all", minRating: 2, includeVideo: false, since: SINCE } },
    };
    const shown = projectColumnsFromForm(custom);
    const next = legacyPatchToFormPatch(
      { autoApprove: shown.autoApprove, autoApproveMinRating: shown.autoApproveMinRating, autoApproveVideo: shown.autoApproveVideo },
      custom,
      NOW,
    );
    expect(next.settings.autoApprove).toEqual(custom.settings.autoApprove);
    expect(legacyPatchToFormPatch({ autoApproveMinRating: 5 }, custom, NOW).settings.autoApprove).toMatchObject({ mode: "all", minRating: 5 });
  });

  it("turning the rule on from off applies the rating the panel shows, not a hidden lower one", () => {
    const base = formConfigFromProject(project);
    const off: FormConfig = { ...base, settings: { ...base.settings, autoApprove: { ...base.settings.autoApprove, mode: "off", minRating: 2 } } };
    expect(legacyPatchToFormPatch({ autoApprove: true, autoApproveMinRating: 4 }, off, NOW).settings.autoApprove).toMatchObject({
      mode: "rating",
      minRating: 4,
    });
  });
});

// ------------------------------------------------------- classic layout

describe("classicCompatible", () => {
  const cfg = () => formConfigFromProject(customProject());

  it("accepts what CollectForm renders, including every settings-tab rule", () => {
    expect(classicCompatible(cfg())).toBe(true);
    const c = cfg();
    c.settings = {
      ...c.settings,
      autoApprove: { mode: "all", minRating: 1, includeVideo: true, since: SINCE },
      autoTags: ["form"],
      maxPerIpPerDay: 3,
      closedMessage: "Back soon",
      confirmationEmail: { enabled: true, subject: "Thanks", body: "You're a star" },
      notify: { channelIds: [] },
    };
    expect(classicCompatible(c)).toBe(true);
    // A second question that's switched off isn't shown.
    const pages = withSecondQuestion(c);
    (pages.find((p) => p.type === "question" && p.key === "q2") as QuestionPage).enabled = false;
    expect(classicCompatible({ ...c, pages })).toBe(true);
  });

  it("refuses a second question, custom fields, another locale and design beyond the accent colour", () => {
    expect(classicCompatible({ ...cfg(), pages: withSecondQuestion(cfg()) })).toBe(false);
    const custom = cfg();
    page(custom, "about_you").custom = [{ key: "plan", type: "short", label: "Your plan", required: false }];
    expect(classicCompatible(custom)).toBe(false);
    expect(classicCompatible(cfg(), "ar")).toBe(false);
    expect(classicCompatible({ ...cfg(), labels: { overrides: { submit: "Send" } } })).toBe(false);
    expect(classicCompatible({ ...cfg(), design: { ...cfg().design, theme: "dark" } })).toBe(false);
    expect(classicCompatible({ ...cfg(), design: { ...cfg().design, primary: "#000000" } })).toBe(true);
    const welcome = cfg();
    page(welcome, "welcome").enabled = true;
    expect(classicCompatible(welcome)).toBe(false);
    const privateConsent = cfg();
    page(privateConsent, "consent").allowPrivate = true;
    expect(classicCompatible(privateConsent)).toBe(false);
    const optional = cfg();
    q1(optional).allowImages = 2;
    expect(classicCompatible(optional)).toBe(false);
  });
});

// ---------------------------------------------------------------- parsing

describe("parseFormRow", () => {
  const row = (over: Partial<Form>) => ({ ...ensureDefaultForm(project), ...over });

  it("never throws, falling back to defaults and logging", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = parseFormRow(row({ pages: "{not json", design: "[]", labels: "null", settings: '"x"' }));
    expect(formPagesSchema.safeParse(cfg.pages).success).toBe(true);
    expect(q1(cfg).primary).toBe(true);
    expect(cfg.design.radius).toBe(12);
    expect(cfg.labels).toEqual({ overrides: {} });
    expect(cfg.settings.autoApprove.mode).toBe("off");
    expect(warn).toHaveBeenCalled();
  });

  it("keeps the parts that are still valid", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const good = cfgOf(ensureDefaultForm(project));
    const pages = [...good.pages, { type: "question", key: "Bad Key", title: "" }];
    const cfg = parseFormRow(
      row({
        pages: JSON.stringify(pages),
        design: JSON.stringify({ radius: 4, primary: "not a colour" }),
        settings: JSON.stringify({ ...good.settings, autoApprove: { mode: "all", since: SINCE }, maxPerIpPerDay: -5 }),
      }),
    );
    expect(cfg.pages).toEqual(good.pages);
    expect(cfg.design.radius).toBe(4);
    expect(cfg.design.primary).toBeUndefined();
    expect(cfg.settings.autoApprove).toEqual({ mode: "all", minRating: 4, includeVideo: false, since: SINCE });
    expect(cfg.settings.maxPerIpPerDay).toBeNull();
  });

  it("doesn't log for a row migration 0009 hasn't filled in yet", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = migratedDefaultForm();
    expect(() => parseFormRow(raw)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("toPublicForm", () => {
  it("strips every setting except the closed message and the landscape prompt, and dropdown tags", () => {
    const form = ensureDefaultForm(project);
    const cfg = cfgOf(form);
    cfg.settings = { ...cfg.settings, closedMessage: "Closed for now", landscapePrompt: true, autoTags: ["secret"], maxPerIpPerDay: 2 };
    page(cfg, "about_you").custom = [
      { key: "plan", type: "dropdown", label: "Plan", required: false, options: [{ label: "Enterprise", tag: "enterprise" }, { label: "Free" }] },
    ];
    const pub = toPublicForm({ ...form, logoKey: "images/11111111-1111-4111-8111-111111111111.png" }, cfg);
    expect(pub.settings).toEqual({ closedMessage: "Closed for now", landscapePrompt: true });
    expect(pub.logoUrl).toBe("/api/media/images/11111111-1111-4111-8111-111111111111.png");
    expect(page(pub, "about_you").custom[0].options).toEqual([{ label: "Enterprise" }, { label: "Free" }]);
    expect(JSON.stringify(pub)).not.toMatch(/enterprise"|secret|autoApprove|confirmationEmail/);
    expect(Object.keys(pub).sort()).toEqual(["design", "id", "kind", "labels", "language", "layout", "logoUrl", "name", "pages", "settings", "slug", "status"]);
  });
});

// ---------------------------------------------------------- default form

describe("the default form", () => {
  it("is made classic, at version 1, from the project", () => {
    const p = customProject();
    const form = ensureDefaultForm(p);
    expect(form).toMatchObject({ slug: "default", name: "Default form", layout: "classic", isDefault: true, status: "live", configVersion: 1 });
    expect(cfgOf(form)).toEqual(formConfigFromProject(p));
    expect(formUrl(p, form)).toBe("/c/acme");
  });

  it("is ensured idempotently and race-safely", () => {
    const first = ensureDefaultForm(project);
    expect(ensureDefaultForm(project).id).toBe(first.id);
    expect(getDefaultForm(project.id).id).toBe(first.id);
    // Inside a caller's transaction too (createProject does this).
    expect(getDb().transaction((tx) => ensureDefaultForm(project, tx)).id).toBe(first.id);
    expect(formRows()).toHaveLength(1);
  });

  it("returns the default another request made first, without a constraint error", () => {
    const other = bareProject({ name: "Beta", slug: "beta" });
    const theirs = migratedDefaultForm(other.id);
    expect(() => ensureDefaultForm(other)).not.toThrow();
    expect(ensureDefaultForm(other).id).toBe(theirs.id);
    expect(getDb().select().from(forms).where(eq(forms.projectId, other.id)).all()).toHaveLength(1);
  });

  it("keeps the default another request adds between its lookup and its insert", () => {
    const other = bareProject({ name: "Gamma", slug: "gamma" });
    const db = getDb();
    let theirs: Form | undefined;
    // The lookup misses, and the other request's form lands in that moment.
    vi.spyOn(db, "select").mockImplementationOnce((() => ({
      from: () => ({ where: () => ({ get: () => void (theirs = migratedDefaultForm(other.id)) }) }),
    })) as never);
    const form = ensureDefaultForm(other);
    expect(theirs).toBeDefined();
    expect(form.id).toBe(theirs!.id);
    expect(db.select().from(forms).where(eq(forms.projectId, other.id)).all()).toHaveLength(1);
  });

  it("gets another link when a form already uses “default”", () => {
    const other = createForm(project.id, { name: "Default", slug: "default-x" });
    getDb().delete(forms).where(and(eq(forms.projectId, project.id), eq(forms.isDefault, true))).run();
    getDb().update(forms).set({ slug: "default" }).where(eq(forms.id, other.id)).run();
    const form = ensureDefaultForm(project);
    expect(form).toMatchObject({ isDefault: true, slug: "default-2" });
  });

  it("is filled in from the project the first time it's read (version 0 → 1), once", () => {
    const p = { ...customProject() };
    const raw = migratedDefaultForm();
    const form = getDefaultForm(project.id);
    expect(form.id).toBe(raw.id);
    expect(form.configVersion).toBe(1);
    expect(cfgOf(form)).toEqual(formConfigFromProject(p));
    // Later column changes no longer rewrite it: the form is now the source of truth.
    getDb().update(projects).set({ prompt: "Changed behind its back" }).where(eq(projects.id, project.id)).run();
    expect(q1(cfgOf(getDefaultForm(project.id))).title).toBe(p.prompt);
    // getForm and getFormBySlug fill a version 0 row in as well.
    const beta = createProject({ name: "Beta", slug: "beta", questions: "" });
    const betaRaw = migratedDefaultForm(beta.id);
    expect(q1(cfgOf(getForm(betaRaw.id)!)).tips).toEqual(DEFAULT_QUESTIONS);
    expect(getFormBySlug(beta.id, "default")!.form.configVersion).toBe(1);
  });

  it("can't be deleted", async () => {
    const form = ensureDefaultForm(project);
    await expect(deleteForm(form.id)).rejects.toThrow(FormError);
    await expect(deleteForm(form.id)).rejects.toMatchObject({ status: 409 });
    expect(getForm(form.id)).not.toBeNull();
  });
});

// ---------------------------------------------------------------- updates

describe("updateForm", () => {
  it("rewrites the mirrored project columns when it's the default form", () => {
    const form = ensureDefaultForm(project);
    const cfg = cfgOf(form);
    q1(cfg).title = "What changed for you?";
    q1(cfg).tips = ["Before", "After"];
    q1(cfg).mode = "text";
    page(cfg, "thank_you").message = "Much appreciated";
    const before = Date.now();
    updateForm(form.id, {
      pages: cfg.pages,
      design: { ...cfg.design, primary: "#123456" },
      settings: { ...cfg.settings, autoApprove: { mode: "rating", minRating: 2, includeVideo: true, since: null } },
    });
    const p = reload();
    expect(p).toMatchObject({
      prompt: "What changed for you?",
      questions: "Before\nAfter",
      allowVideo: false,
      allowText: true,
      thankYouMessage: "Much appreciated",
      accentColor: "#123456",
      autoApprove: true,
      autoApproveMinRating: 4,
      autoApproveVideo: true,
    });
    // since is bookkeeping: turning the rule on starts it now, on the form and the project alike.
    const rule = cfgOf(getForm(form.id)!).settings.autoApprove;
    expect(rule.minRating).toBe(2);
    expect(rule.since!.getTime()).toBeGreaterThanOrEqual(before);
    expect(p.autoApproveSince!.getTime()).toBe(rule.since!.getTime());
    // Staying on keeps the date; off clears it on both.
    updateForm(form.id, { settings: { ...cfgOf(getForm(form.id)!).settings, autoApprove: { ...rule, minRating: 5, since: null } } });
    expect(reload().autoApproveSince!.getTime()).toBe(rule.since!.getTime());
    expect(reload().autoApproveMinRating).toBe(5);
    updateForm(form.id, { settings: { ...cfgOf(getForm(form.id)!).settings, autoApprove: { ...rule, mode: "off" } } });
    expect(reload()).toMatchObject({ autoApprove: false, autoApproveSince: null });
    expect(cfgOf(getForm(form.id)!).settings.autoApprove.since).toBeNull();
  });

  it("leaves the project alone for any other form", () => {
    ensureDefaultForm(project);
    const before = reload();
    const other = createForm(project.id, { name: "Agencies" });
    const cfg = cfgOf(other);
    q1(cfg).title = "Only on this form";
    updateForm(other.id, { name: "Agency stories", pages: cfg.pages, settings: { ...cfg.settings, autoApprove: { ...cfg.settings.autoApprove, mode: "all" } } });
    expect(reload()).toEqual(before);
    expect(getForm(other.id)).toMatchObject({ name: "Agency stories" });
    expect(q1(cfgOf(getForm(other.id)!)).title).toBe("Only on this form");
  });

  it("refuses an invalid config, and a classic form refuses what CollectForm can't show", () => {
    const form = ensureDefaultForm(project);
    const cfg = cfgOf(form);
    const noMain = cfg.pages.filter((p) => p.type !== "question");
    expect(() => updateForm(form.id, { pages: noMain })).toThrow(/exactly one main question/);
    expect(() => updateForm(form.id, { pages: withSecondQuestion(cfg) })).toThrow(FormError);
    expect(() => updateForm(form.id, { language: "fr" })).toThrow(/step-by-step/);
    expect(() => updateForm(form.id, { pages: withSecondQuestion(cfg) })).toThrow(expect.objectContaining({ status: 409 }));
    expect(updateForm("missing", { name: "x" })).toBeNull();
    expect(cfgOf(getForm(form.id)!)).toEqual(cfg);
  });

  it("allows it once the form is step by step; upgradeToSteps keeps the config", () => {
    const form = ensureDefaultForm(project);
    const cfg = cfgOf(form);
    const upgraded = upgradeToSteps(form.id);
    expect(upgraded.layout).toBe("steps");
    expect({ ...cfgOf(upgraded), layout: "classic" }).toEqual(cfg);
    expect(formUrl(project, upgraded)).toBe("/f/acme/default");
    expect(upgradeToSteps(form.id).layout).toBe("steps");
    const saved = updateForm(form.id, { pages: withSecondQuestion(cfg), language: "fr" })!;
    expect(saved.language).toBe("fr");
    expect(cfgOf(saved).pages.filter((p) => p.type === "question")).toHaveLength(2);
    // The mirror still follows the main question.
    expect(reload().prompt).toBe(q1(cfg).title);
  });
});

describe("applyLegacyPatch (updateProject's half of the mirror)", () => {
  it("writes the form and the columns together, keeping what the panel sent", () => {
    const p = applyLegacyPatch(project, {
      prompt: "Tell us more",
      questions: "",
      allowText: true,
      allowVideo: true,
      maxVideoSeconds: 60,
      consentText: "",
      accentColor: "#0f766e",
      thankYouMessage: "Thanks!",
    });
    expect(p).toMatchObject({ prompt: "Tell us more", questions: "", consentText: "", maxVideoSeconds: 60, thankYouMessage: "Thanks!" });
    expect(reload()).toEqual(p);
    const cfg = cfgOf(getDefaultForm(project.id));
    expect(q1(cfg)).toMatchObject({ title: "Tell us more", tips: DEFAULT_QUESTIONS, maxVideoSeconds: 60 });
    expect(page(cfg, "thank_you").message).toBe("Thanks!");
  });

  it("starts auto-approve now on both, and keeps a builder rule the panel can't show", () => {
    const before = Date.now();
    const p = applyLegacyPatch(project, { autoApprove: true, autoApproveMinRating: 4, autoApproveVideo: false });
    expect(p.autoApprove).toBe(true);
    expect(p.autoApproveSince!.getTime()).toBeGreaterThanOrEqual(before);
    const form = getDefaultForm(project.id);
    expect(cfgOf(form).settings.autoApprove.since!.getTime()).toBe(p.autoApproveSince!.getTime());
    // The owner sets "2+ stars" in the builder; a SettingsPanel save of the same 4 leaves it.
    const settings = cfgOf(form).settings;
    updateForm(form.id, { settings: { ...settings, autoApprove: { ...settings.autoApprove, minRating: 2 } } });
    applyLegacyPatch(reload(), { autoApprove: true, autoApproveMinRating: 4, autoApproveVideo: false });
    expect(cfgOf(getForm(form.id)!).settings.autoApprove).toMatchObject({ mode: "rating", minRating: 2 });
    expect(reload().autoApproveMinRating).toBe(4);
    // Saving again while it's on keeps the time it was turned on (as updateProject did).
    expect(reload().autoApproveSince!.getTime()).toBe(p.autoApproveSince!.getTime());
    expect(cfgOf(getForm(form.id)!).settings.autoApprove.since!.getTime()).toBe(p.autoApproveSince!.getTime());
    const off = applyLegacyPatch(reload(), { autoApprove: false });
    expect(off).toMatchObject({ autoApprove: false, autoApproveSince: null });
    expect(autoApproveRuleFor({ formId: null, projectId: project.id })).toMatchObject({ mode: "off", since: null });
  });

  it("runs inside the caller's transaction and does nothing without a legacy field", () => {
    const p = getDb().transaction((tx) => applyLegacyPatch(project, { prompt: "In a transaction" }, tx));
    expect(p.prompt).toBe("In a transaction");
    expect(applyLegacyPatch(p, {})).toBe(p);
  });
});

// ------------------------------------------------------- the other forms

describe("other forms", () => {
  it("start step by step, from the project, with a link made from the name and rules off", () => {
    const p = customProject();
    const form = createForm(p.id, { name: "Agency Stories!", template: "agency" });
    expect(form).toMatchObject({ slug: "agency-stories", layout: "steps", isDefault: false, status: "live", template: "agency", configVersion: 1 });
    const cfg = cfgOf(form);
    expect(q1(cfg).title).toBe(p.prompt);
    expect(cfg.settings.autoApprove).toMatchObject({ mode: "off", since: null });
    expect(cfg.design.primary).toBeUndefined();
    expect(formUrl(p, form)).toBe("/f/acme/agency-stories");
    expect(createForm(p.id, { name: "Agency stories" }).slug).toBe("agency-stories-2");
    // The project got its default form first.
    expect(formRows().filter((f) => f.isDefault)).toHaveLength(1);
  });

  it("take a config (a template's), validated, with a rule that's on starting now", () => {
    const base = formConfigFromProject(project);
    const pages = withSecondQuestion(base);
    const form = createForm(project.id, {
      name: "Course",
      config: { pages, settings: { ...base.settings, autoApprove: { mode: "all", minRating: 1, includeVideo: false, since: SINCE } } },
    });
    const cfg = cfgOf(form);
    expect(cfg.pages).toEqual(pages);
    expect(cfg.settings.autoApprove.since!.getTime()).toBeGreaterThan(SINCE.getTime());
    expect(() => createForm(project.id, { name: "Bad", config: { pages: [] } })).toThrow(FormError);
    expect(() => createForm(project.id, { name: "  " })).toThrow(/name/);
    expect(() => createForm("missing", { name: "x" })).toThrow(expect.objectContaining({ status: 404 }));
  });

  it("duplicate with a new link, step by step, sharing the config", () => {
    const form = ensureDefaultForm(project);
    const copy = duplicateForm(form.id)!;
    expect(copy).toMatchObject({ name: "Default form (copy)", slug: "default-copy", isDefault: false, layout: "steps" });
    expect(copy.id).not.toBe(form.id);
    expect({ ...cfgOf(copy), layout: "classic" }).toEqual(cfgOf(form));
    expect(duplicateForm(form.id)!.slug).toBe("default-copy-2");
    expect(duplicateForm("missing")).toBeNull();
  });

  it("can be deleted: testimonials and requests stay, unlinked, and an unshared logo goes", async () => {
    const form = createForm(project.id, { name: "Events" });
    const t = createTestimonial(project.id, { name: "Ada", text: "Great event" });
    getDb().update(testimonials).set({ formId: form.id }).where(eq(testimonials.id, t.id)).run();
    const logo = await saveUpload(new File([PNG_BYTES], "logo.png", { type: "image/png" }), "image");
    updateForm(form.id, { logoKey: logo.key });
    const copy = duplicateForm(form.id)!;
    expect(copy.logoKey).toBe(logo.key);

    expect(await deleteForm(form.id)).toBe(true);
    expect(getForm(form.id)).toBeNull();
    expect(getDb().select().from(testimonials).where(eq(testimonials.id, t.id)).get()?.formId).toBeNull();
    // The copy still uses the logo, so the file stays until the last form using it goes.
    expect(fs.existsSync(resolveKey(logo.key))).toBe(true);
    expect(await deleteForm(copy.id)).toBe(true);
    expect(fs.existsSync(resolveKey(logo.key))).toBe(false);
    expect(await deleteForm(copy.id)).toBe(false);
  });

  it("pause and go live again", () => {
    const form = createForm(project.id, { name: "Events" });
    expect(setFormStatus(form.id, "paused").status).toBe("paused");
    expect(setFormStatus(form.id, "live").status).toBe("live");
    expect(() => setFormStatus("missing", "paused")).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe("slugs and old links", () => {
  it("keep an old link working after a rename", () => {
    const form = createForm(project.id, { name: "SaaS" });
    expect(changeFormSlug(form.id, "software").slug).toBe("software");
    expect(getFormBySlug(project.id, "software")).toEqual({ form: getForm(form.id) });
    expect(getFormBySlug(project.id, "saas")).toEqual({ form: getForm(form.id), redirectedFrom: "saas" });
    // A second rename keeps both old links pointing at the form.
    changeFormSlug(form.id, "apps");
    expect(getFormBySlug(project.id, "saas")?.form.id).toBe(form.id);
    expect(getFormBySlug(project.id, "software")?.form.id).toBe(form.id);
    // Renaming back takes the link over from its alias.
    changeFormSlug(form.id, "saas");
    expect(getFormBySlug(project.id, "saas")).toEqual({ form: getForm(form.id) });
    expect(getFormBySlug(project.id, "nothing")).toBeNull();
  });

  it("let a new live slug beat an alias (D17) and refuse one another form uses", () => {
    const a = createForm(project.id, { name: "First" });
    changeFormSlug(a.id, "renamed");
    const b = createForm(project.id, { name: "Second", slug: "first" });
    expect(getFormBySlug(project.id, "first")).toEqual({ form: getForm(b.id) });
    expect(
      getDb().select().from(slugRedirects).where(and(eq(slugRedirects.scope, project.id), eq(slugRedirects.oldSlug, "first"))).all(),
    ).toEqual([]);
    expect(() => changeFormSlug(a.id, "first")).toThrow(FormSlugTakenError);
    expect(() => createForm(project.id, { name: "Third", slug: "renamed" })).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => changeFormSlug(a.id, "Not A Slug!")).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => changeFormSlug("missing", "fine")).toThrow(expect.objectContaining({ status: 404 }));
    // Another project's links are separate.
    const beta = createProject({ name: "Beta", slug: "beta" });
    expect(createForm(beta.id, { name: "Renamed", slug: "renamed" }).slug).toBe("renamed");
    expect(getFormBySlug(project.id, "renamed")?.form.id).toBe(a.id);
  });
});

describe("setDefaultForm", () => {
  it("moves the default and the project's mirrored columns follow the new one", () => {
    const old = ensureDefaultForm(project);
    const form = createForm(project.id, { name: "Stories" });
    const cfg = cfgOf(form);
    q1(cfg).title = "Tell us a story";
    updateForm(form.id, { pages: cfg.pages, settings: { ...cfg.settings, autoApprove: { mode: "rating", minRating: 5, includeVideo: false, since: null } } });
    setDefaultForm(project.id, form.id);
    expect(formRows().filter((f) => f.isDefault).map((f) => f.id)).toEqual([form.id]);
    expect(getForm(old.id)?.isDefault).toBe(false);
    expect(reload()).toMatchObject({ prompt: "Tell us a story", autoApprove: true, autoApproveMinRating: 5 });
    expect(getDefaultForm(project.id).id).toBe(form.id);
    expect(() => setDefaultForm(project.id, "missing")).toThrow(expect.objectContaining({ status: 404 }));
    const beta = createProject({ name: "Beta", slug: "beta" });
    expect(() => setDefaultForm(beta.id, form.id)).toThrow(FormError);
  });
});

describe("listForms", () => {
  it("lists the default first with its counts; requests without a form count for the default", () => {
    const def = ensureDefaultForm(project);
    const other = createForm(project.id, { name: "Events" });
    const link = (id: string, formId: string | null) =>
      getDb().update(schema.testimonials).set({ formId }).where(eq(schema.testimonials.id, id)).run();
    for (let i = 0; i < 3; i++) link(createTestimonial(project.id, { name: `D${i}`, text: "x" }).id, def.id);
    link(createTestimonial(project.id, { name: "E", text: "x" }).id, other.id);
    const trashed = createTestimonial(project.id, { name: "T", text: "x" });
    link(trashed.id, other.id);
    getDb().update(testimonials).set({ status: "trashed" }).where(eq(testimonials.id, trashed.id)).run();
    createTestimonial(project.id, { name: "API", text: "x" }, { source: "api" });

    createRequests(reload(), [{ email: "a@example.com" }, { email: "b@example.com" }, { email: "c@example.com" }], { send: false });
    const reqs = getDb().select().from(schema.requests).all();
    getDb().update(schema.requests).set({ formId: other.id, respondedAt: new Date(), status: "responded" }).where(eq(schema.requests.id, reqs[0].id)).run();
    getDb().update(schema.requests).set({ respondedAt: new Date(), status: "responded" }).where(eq(schema.requests.id, reqs[1].id)).run();

    const list = listForms(project.id);
    expect(list.map((f) => f.id)).toEqual([def.id, other.id]);
    expect(list[0].stats).toEqual({ submissions: 3, invites: 2, responded: 1, responseRate: 50 });
    expect(list[1].stats).toEqual({ submissions: 1, invites: 1, responded: 1, responseRate: 100 });
    expect(listForms("missing")).toEqual([]);
  });
});

describe("autoApproveRuleFor", () => {
  it("uses the testimonial's form, else the project's default form", () => {
    applyLegacyPatch(project, { autoApprove: true, autoApproveMinRating: 5 });
    const def = getDefaultForm(project.id);
    const other = createForm(project.id, { name: "Events" });
    const s = cfgOf(other).settings;
    updateForm(other.id, { settings: { ...s, autoApprove: { mode: "all", minRating: 1, includeVideo: true, since: null } } });
    expect(autoApproveRuleFor({ formId: other.id, projectId: project.id })).toMatchObject({ mode: "all", includeVideo: true });
    expect(autoApproveRuleFor({ formId: def.id, projectId: project.id })).toMatchObject({ mode: "rating", minRating: 5 });
    expect(autoApproveRuleFor({ formId: null, projectId: project.id })).toMatchObject({ mode: "rating", minRating: 5 });
    expect(autoApproveRuleFor({ formId: "deleted", projectId: project.id })).toMatchObject({ mode: "rating", minRating: 5 });
    // A form of another project never decides.
    const beta = createProject({ name: "Beta", slug: "beta" });
    expect(autoApproveRuleFor({ formId: other.id, projectId: beta.id })).toMatchObject({ mode: "off" });
    expect(autoApproveRuleFor({ formId: null, projectId: "missing" })).toEqual({ mode: "off", minRating: 4, includeVideo: false, since: null });
  });
});
