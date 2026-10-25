import { describe, expect, it } from "vitest";
import {
  buildSubmissionSchema,
  emptyAnswers,
  parsePrefill,
  pickPrimary,
  tagsFromSubmission,
  thankYouFor,
  validateStep,
  visiblePages,
} from "@/lib/forms/engine";
import { resolveLabels } from "@/lib/forms/labels";
import { formDesignSchema, formLabelsSchema, formPagesSchema, formSettingsSchema, type FormConfig, type FormPage } from "@/lib/forms/schema";

const labels = resolveLabels("en");

function form(pages: unknown[], settings: Record<string, unknown> = {}): FormConfig {
  return {
    v: 1,
    layout: "steps",
    pages: formPagesSchema.parse(pages),
    design: formDesignSchema.parse({}),
    labels: formLabelsSchema.parse({}),
    settings: formSettingsSchema.parse(settings),
  };
}

const THREE = form(
  [
    { type: "rating", required: true },
    { type: "welcome", enabled: false },
    { type: "question", key: "q1", primary: true, title: "What changed?" },
    { type: "question", key: "q2", title: "Anything else?", required: false, mode: "text" },
    { type: "question", key: "q3", title: "Say hi on camera", mode: "video" },
    { type: "feedback", key: "private_note", title: "Anything just for us?", enabled: true },
    { type: "consent", scopes: ["social", "ads"], allowPrivate: true },
    {
      type: "about_you",
      custom: [
        {
          key: "plan",
          type: "dropdown",
          label: "Your plan",
          required: true,
          options: [{ label: "Starter" }, { label: "Enterprise", tag: "enterprise" }],
        },
        { key: "nps", type: "nps", label: "How likely are you to recommend us?" },
        { key: "site", type: "url", label: "Your site" },
        { key: "seats", type: "number", label: "Seats" },
        { key: "ok", type: "checkbox", label: "You may contact me" },
      ],
    },
    { type: "review", enabled: true },
    { type: "thank_you", title: "Thanks!", low: { title: "Sorry to hear that", message: "We'll be in touch." } },
  ],
  { hiddenFields: ["utm_source", "order_id"], lockPrefill: ["email"], autoTags: ["form-v2"] },
);

const page = (type: FormPage["type"], key?: string) =>
  THREE.pages.find((p) => p.type === type && (!key || ("key" in p && p.key === key)))!;

const base = {
  rating: 5,
  answers: [
    { key: "q1", text: "It saved us hours." },
    { key: "q3", videoUpload: "u3", videoUploadToken: "t3" },
  ],
  person: { name: "Ada" },
  customFields: { plan: "Enterprise" },
  consent: { agreed: true as const },
};

describe("visiblePages", () => {
  it("FORM-03 skips disabled pages and leaves out the thank-you page", () => {
    expect(visiblePages(THREE).map((p) => p.type)).toEqual([
      "rating",
      "question",
      "question",
      "question",
      "feedback",
      "consent",
      "about_you",
      "review",
    ]);
  });
});

describe("validateStep", () => {
  it("FORM-03 checks each step on its own", () => {
    const s = emptyAnswers(THREE);
    expect(validateStep(page("rating"), s, labels)).toEqual({ rating: labels.errorRating });
    expect(validateStep(page("question", "q1"), s, labels)).toEqual({ "q:q1": labels.errorRequired });
    expect(validateStep(page("consent"), s, labels)).toEqual({ consent: labels.errorConsent });
    const about = validateStep(page("about_you"), s, labels);
    expect(about.name).toBe("Please enter your name");
    expect(about["c:plan"]).toBe(labels.errorField);
    s.rating = 4;
    s.answers.q1.text = "Great";
    s.consent.agreed = true;
    s.person.name = "Ada";
    s.custom.plan = "Enterprise";
    for (const p of visiblePages(THREE).filter((p) => p.type !== "question" || p.key !== "q3")) {
      expect(validateStep(p, s, labels)).toEqual({});
    }
  });

  it("FORM-05 lets an optional question be skipped but not a required one", () => {
    const s = emptyAnswers(THREE);
    expect(validateStep(page("question", "q2"), s, labels)).toEqual({});
    expect(validateStep(page("question", "q3"), s, labels)).toEqual({ "q:q3": labels.errorVideo });
    s.answers.q3.hasVideo = true;
    expect(validateStep(page("question", "q3"), s, labels)).toEqual({});
  });

  it("FORM-06 checks custom field types", () => {
    const s = emptyAnswers(THREE);
    Object.assign(s.person, { name: "Ada" });
    Object.assign(s.custom, { plan: "Gold", nps: "11", site: "not a site", seats: "many" });
    const e = validateStep(page("about_you"), s, labels);
    expect(e).toMatchObject({ "c:plan": labels.errorField, "c:nps": labels.errorField, "c:site": labels.errorUrl, "c:seats": labels.errorNumber });
  });
});

describe("buildSubmissionSchema", () => {
  const schema = buildSubmissionSchema(THREE);

  it("FORM-04 keeps one answer per question and respects each question's mode", () => {
    const parsed = schema.parse({
      ...base,
      answers: [
        { key: "q1", text: "It saved us hours.", videoUpload: "u1", videoUploadToken: "t1" },
        { key: "q2", text: "Text only", videoUpload: "nope" },
        { key: "q3", text: "dropped: video only", videoUpload: "u3", videoUploadToken: "t3" },
        { key: "zz", text: "unknown question" },
      ],
    });
    expect(parsed.answers).toEqual([
      { key: "q1", text: "It saved us hours.", videoUpload: "u1", videoUploadToken: "t1" },
      { key: "q2", text: "Text only" },
      { key: "q3", text: undefined, videoUpload: "u3", videoUploadToken: "t3" },
    ]);
  });

  it("FORM-05 refuses a missing required answer and accepts a skipped optional one", () => {
    expect(schema.safeParse(base).success).toBe(true);
    const missing = schema.safeParse({ ...base, answers: [{ key: "q1", text: "Only one" }] });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0].message).toContain("Say hi on camera");
  });

  it("FORM-06 stores custom values typed, drops unknown keys and refuses bad ones", () => {
    const ok = schema.parse({ ...base, customFields: { plan: "Enterprise", nps: 9, seats: "12", ok: true, other: "x" } });
    expect(ok.customFields).toEqual({ plan: "Enterprise", nps: 9, seats: 12, ok: true });
    expect(schema.safeParse({ ...base, customFields: { plan: "Gold" } }).success).toBe(false);
    expect(schema.safeParse({ ...base, customFields: { plan: "Starter", site: "javascript:alert(1)" } }).success).toBe(false);
  });

  it("FORM-07 keeps only allow-listed hidden fields", () => {
    const parsed = schema.parse({ ...base, hiddenFields: { utm_source: "newsletter", secret: "x" } });
    expect(parsed.hiddenFields).toEqual({ utm_source: "newsletter" });
  });

  it("FORM-10 keeps only the consent options the form offers", () => {
    const parsed = schema.parse({ ...base, consent: { agreed: true, public: false, scopes: ["social", "face", "website"] } });
    expect(parsed.consent).toEqual({ agreed: true, public: false, scopes: ["social"] });
    const strict = buildSubmissionSchema(form([...THREE.pages.filter((p) => p.type !== "consent"), { type: "consent" }]));
    expect(strict.safeParse({ ...base, consent: { agreed: true, public: false } }).success).toBe(false);
  });

  it("FORM-03 requires a rating only when the rating page asks for one", () => {
    expect(schema.safeParse({ ...base, rating: undefined }).success).toBe(false);
  });
});

describe("pickPrimary", () => {
  it("FORM-04 uses the main question, or the first answered one when it was skipped", () => {
    expect(pickPrimary(THREE, base.answers)).toMatchObject({ questionKey: "q1", text: "It saved us hours." });
    const optionalMain = form([
      { type: "question", key: "q1", primary: true, required: false, title: "Main" },
      { type: "question", key: "q2", title: "Second" },
      { type: "consent" },
      { type: "about_you" },
      { type: "thank_you" },
    ]);
    expect(pickPrimary(optionalMain, [{ key: "q2", videoUpload: "u2" }])).toMatchObject({ questionKey: "q2", videoUpload: "u2" });
    expect(pickPrimary(optionalMain, [])).toBeNull();
  });
});

describe("parsePrefill", () => {
  it("FORM-07 reads details and hidden fields, locks what the owner locked", () => {
    const p = parsePrefill({ name: "Ada", email: "ada@example.com", utm_source: ["ads", "x"], secret: "no" }, THREE);
    expect(p.person).toEqual({ name: "Ada", email: "ada@example.com" });
    expect(p.hidden).toEqual({ utm_source: "ads" });
    expect(p.locked).toEqual(["email"]);
  });

  it("FORM-07 caps what a link can carry", () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, "v"]));
    const p = parsePrefill({ ...many, name: "x".repeat(500), utm_source: "late" }, THREE);
    expect(p.person.name).toBeUndefined(); // past the first 20 parameters
    expect(parsePrefill({ name: "x".repeat(500) }, THREE).person.name).toHaveLength(200);
    expect(parsePrefill({ email: "not-an-email" }, THREE).person.email).toBeUndefined();
  });

  it("FORM-07 lets a signed request link win over plain parameters", () => {
    const p = parsePrefill({ name: "Typed", email: "typed@example.com" }, THREE, { name: "Invited", email: "invited@example.com", company: null });
    expect(p.person).toEqual({ name: "Invited", email: "invited@example.com" });
  });
});

describe("after sending", () => {
  it("FORM-06 maps a dropdown choice to a tag, with the form's auto-tags", () => {
    expect(tagsFromSubmission(THREE, { plan: "Enterprise" })).toEqual(["form-v2", "enterprise"]);
    expect(tagsFromSubmission(THREE, { plan: "Starter" })).toEqual(["form-v2"]);
  });

  it("FORM-16 shows the low-rating thank-you for 3 stars or fewer", () => {
    expect(thankYouFor(THREE, 5).title).toBe("Thanks!");
    expect(thankYouFor(THREE, 3)).toMatchObject({ title: "Sorry to hear that", message: "We'll be in touch." });
    expect(thankYouFor(THREE).title).toBe("Thanks!");
  });
});
