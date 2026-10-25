import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db";
import { checkAutoApprove, checkRule, maybeAutoApprove, ruleFor, ruleFromProject, ruleLabel } from "@/lib/auto-approve";
import { autoApproveRuleFor } from "@/lib/forms";
import type { AutoApproveRule } from "@/lib/forms/schema";
import { createProject, createTestimonial, getProjectById, getTestimonial, updateProject } from "@/lib/testimonials";
import { useTempDataDir } from "./helpers";

// The forms contract (WP1.2) decides a form's own rule; here it's stood in for,
// so these tests cover how the rule is chosen and applied.
vi.mock("@/lib/forms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms")>()),
  autoApproveRuleFor: vi.fn(),
}));

const SINCE = new Date("2026-01-01T00:00:00Z");
const rule = (r: Partial<AutoApproveRule>): AutoApproveRule => ({ mode: "rating", minRating: 4, includeVideo: false, since: SINCE, ...r });
const text = {
  status: "pending",
  source: "form",
  rating: 4,
  text: "It saved us hours every week.",
  videoKey: null,
  mediaStatus: "none",
  withdrawnAt: null,
  createdAt: new Date("2026-02-01T00:00:00Z"),
  consentPublic: true,
} as const;
const video = { ...text, text: null, videoKey: "videos/a.webm", mediaStatus: "ready" } as const;
type T = Parameters<typeof checkRule>[1];
const check = (r: Partial<AutoApproveRule>, t: Partial<T> = {}) => checkRule(rule(r), { ...text, ...t });

const MODES = ["all", "rating", "text", "public"] as const;

describe("FORM-10 auto-approve modes", () => {
  it("off approves nothing, and neither does a rule that was never turned on", () => {
    expect(check({ mode: "off" }, { rating: 5 })).toEqual({ approve: false, reason: "auto-approve is off" });
    for (const mode of MODES) expect(check({ mode, since: null })).toEqual({ approve: false, reason: "auto-approve is off" });
  });

  it("all approves any new form testimonial, rated or not", () => {
    expect(check({ mode: "all" }, { rating: null })).toEqual({ approve: true, rule: "every testimonial" });
    expect(check({ mode: "all" }, { rating: 1 })).toEqual({ approve: true, rule: "every testimonial" });
  });

  it("rating approves at or above any minimum from 1 to 5", () => {
    expect(check({ minRating: 1 }, { rating: 1 })).toEqual({ approve: true, rule: "1+ stars" });
    expect(check({ minRating: 3 }, { rating: 2 })).toEqual({ approve: false, reason: "rated 2, below 3" });
    expect(check({ minRating: 3 }, { rating: 3 })).toEqual({ approve: true, rule: "3+ stars" });
    expect(check({ minRating: 5 }, { rating: 5 })).toEqual({ approve: true, rule: "5 stars" });
    expect(check({ minRating: 2 }, { rating: null })).toEqual({ approve: false, reason: "no rating" });
  });

  it("text approves written testimonials of any rating, and leaves videos for the owner", () => {
    expect(check({ mode: "text" }, { rating: 2 })).toEqual({ approve: true, rule: "text only" });
    expect(checkRule(rule({ mode: "text", includeVideo: true }), video)).toEqual({
      approve: false,
      reason: "only text testimonials are approved automatically",
    });
    expect(check({ mode: "text" }, { text: "   " })).toEqual({ approve: false, reason: "no text" });
  });

  it("public approves what the author agreed to make public", () => {
    expect(check({ mode: "public" }, { rating: null })).toEqual({ approve: true, rule: "public consent" });
  });

  it("never approves one the author asked to keep private, in any mode", () => {
    for (const mode of MODES) {
      expect(check({ mode }, { consentPublic: false, rating: 5 })).toEqual({ approve: false, reason: "the author asked to keep it private" });
    }
  });

  it("leaves text with a link for the owner in every mode", () => {
    for (const mode of MODES) {
      expect(check({ mode }, { text: "Buy at https://spam.example", rating: 5 })).toEqual({
        approve: false,
        reason: "the text contains a link",
      });
      expect(check({ mode }, { text: "see www.spam.example", rating: 5 })).toMatchObject({ approve: false });
    }
  });

  it("in every mode, only counts the form, new arrivals, and pending, unwithdrawn ones", () => {
    for (const mode of MODES) {
      expect(check({ mode }, { source: "api" })).toEqual({ approve: false, reason: "added by api, not the collection form" });
      expect(check({ mode }, { createdAt: new Date("2025-12-31T00:00:00Z") })).toEqual({
        approve: false,
        reason: "sent before auto-approve was turned on",
      });
      expect(check({ mode }, { withdrawnAt: new Date() })).toEqual({ approve: false, reason: "withdrawn" });
      expect(check({ mode }, { status: "hidden" })).toEqual({ approve: false, reason: "already hidden" });
    }
  });

  it("includes videos only when asked and once they're processed, in every mode but text", () => {
    for (const mode of ["all", "rating", "public"] as const) {
      expect(checkRule(rule({ mode }), video)).toEqual({ approve: false, reason: "videos aren't included" });
      expect(checkRule(rule({ mode, includeVideo: true }), video)).toEqual({ approve: true, rule: ruleLabel(rule({ mode })) });
      expect(checkRule(rule({ mode, includeVideo: true }), { ...video, mediaStatus: "processing" })).toEqual({
        approve: false,
        reason: "the video is still processing",
      });
    }
  });

  it("reads the project's settings as a rating rule, as the existing checks expect", () => {
    const p = { autoApprove: true, autoApproveMinRating: 5, autoApproveVideo: true, autoApproveSince: SINCE };
    expect(ruleFromProject(p)).toEqual({ mode: "rating", minRating: 5, includeVideo: true, since: SINCE });
    expect(ruleFromProject({ ...p, autoApprove: false }).mode).toBe("off");
    expect(checkAutoApprove(p, { ...text, rating: 5 })).toEqual(checkRule(ruleFromProject(p), { ...text, rating: 5 }));
  });
});

describe("which rule applies", () => {
  let ctx: ReturnType<typeof useTempDataDir>;
  let projectId: string;
  const formRule = vi.mocked(autoApproveRuleFor);

  beforeEach(() => {
    ctx = useTempDataDir();
    projectId = createProject({ name: "Acme", slug: "acme" }).id;
    formRule.mockReset();
  });
  afterEach(() => ctx.cleanup());

  function addForm(configVersion: number) {
    const id = crypto.randomUUID();
    getDb()
      .insert(schema.forms)
      .values({ id, projectId, slug: `f-${id.slice(0, 8)}`, name: "Second", layout: "steps", configVersion })
      .run();
    return id;
  }

  const submitted = (formId: string | null, rating = 5) =>
    createTestimonial(projectId, { name: "Ada", text: "Lovely", rating, formId }, { source: "form" }).id;

  it("FORM-10 a form's own rule beats the project's", () => {
    const formId = addForm(1);
    formRule.mockReturnValue({ mode: "all", minRating: 4, includeVideo: false, since: SINCE });
    const id = submitted(formId, 2);
    expect(maybeAutoApprove(id)).toMatchObject({ status: "approved", approvedBy: "auto", approvalRule: "every testimonial" });
    expect(formRule).toHaveBeenCalledWith(expect.objectContaining({ id, formId }));
  });

  it("a form can turn it off while the project has it on", () => {
    updateProject(projectId, { autoApprove: true });
    const formId = addForm(1);
    formRule.mockReturnValue({ mode: "off", minRating: 4, includeVideo: false, since: null });
    const id = submitted(formId);
    expect(maybeAutoApprove(id)).toBeNull();
    expect(getTestimonial(id)!.status).toBe("pending");
  });

  it("a default form not yet given its own config follows the project's settings", () => {
    updateProject(projectId, { autoApprove: true, autoApproveMinRating: 5 });
    // As migration 0009 leaves an older project's default form.
    getDb().update(schema.forms).set({ configVersion: 0, pages: "[]", settings: "{}" }).run();
    const def = getDb().select().from(schema.forms).all();
    expect(def).toMatchObject([{ projectId, isDefault: true, layout: "classic", configVersion: 0 }]);
    const four = submitted(def[0].id, 4);
    const five = submitted(null, 5);
    expect(maybeAutoApprove(four)).toBeNull();
    expect(maybeAutoApprove(five)).toMatchObject({ status: "approved", approvalRule: "5 stars" });
    expect(ruleFor(getTestimonial(four)!, getProjectById(projectId)!)).toMatchObject({ mode: "rating", minRating: 5 });
    expect(formRule).not.toHaveBeenCalled();
  });

  it("asks the default form once it has its own config, for testimonials without a form", () => {
    // createProject gives the default form its own config.
    formRule.mockReturnValue({ mode: "text", minRating: 4, includeVideo: false, since: SINCE });
    const id = submitted(null, 1);
    expect(maybeAutoApprove(id)).toMatchObject({ status: "approved", approvalRule: "text only" });
  });
});
