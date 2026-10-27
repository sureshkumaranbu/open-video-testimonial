import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDraft, DRAFT_DAYS, draftKey, hasContent, loadDraft, restoreDraft, saveDraft, toDraft } from "@/components/collect/draft";
import { emptyAnswers, visiblePages, type Answers } from "@/lib/forms/engine";
import { formPagesSchema } from "@/lib/forms/schema";

/** A Storage stand-in for the node test environment. */
class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const pages = formPagesSchema.parse([
  { type: "rating" },
  { type: "question", key: "q1", primary: true, title: "What changed?", mode: "text" },
  { type: "question", key: "q2", title: "Say it on camera", mode: "video_text", required: false },
  { type: "consent" },
  { type: "about_you" },
  { type: "thank_you" },
]);
const steps = visiblePages({ pages });
const fresh = (prefill = {}) => emptyAnswers({ pages }, prefill);
const DAY = 24 * 60 * 60 * 1000;

function filled(): Answers {
  const s = fresh();
  s.rating = 5;
  s.answers.q1.text = "We ship weekly now.";
  s.answers.q2 = { ...s.answers.q2, mode: "video", hasVideo: true, videoReady: true, images: 2 };
  s.person.name = "Dee Draft";
  s.person.socials.linkedin = "https://linkedin.example/dee";
  s.custom.plan = "pro";
  s.consent = { agreed: true, public: true, scopes: ["website"] };
  s.hasPhoto = true;
  return s;
}

let store: MemoryStorage;
beforeEach(() => {
  store = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: store });
});
afterEach(() => vi.unstubAllGlobals());

describe("FORM-14 draft autosave", () => {
  it("FORM-14 keeps text, rating, about-you and custom values and the step, never files or consent", () => {
    const draft = toDraft(filled(), steps, 2, 1000);
    saveDraft("form-1", draft);
    const raw = store.getItem(draftKey("form-1"))!;
    expect(raw).not.toMatch(/consent|hasPhoto|videoReady|images/);
    const back = loadDraft("form-1", 2000)!;
    expect(back).toMatchObject({ rating: 5, step: { index: 2, id: "q:q2" }, hadVideo: true, custom: { plan: "pro" } });

    const { state, step } = restoreDraft(back, fresh(), steps);
    expect(step).toBe(2);
    expect(state.rating).toBe(5);
    expect(state.answers.q1.text).toBe("We ship weekly now.");
    // The video is recorded again; the person's choice of video stays.
    expect(state.answers.q2).toEqual({ mode: "video", text: "", hasVideo: false, videoReady: false, images: 0 });
    expect(state.person).toMatchObject({ name: "Dee Draft", socials: { linkedin: "https://linkedin.example/dee" } });
    expect(state.consent).toEqual(fresh().consent);
    expect(state.hasPhoto).toBe(false);
  });

  it("FORM-14 a draft lasts 7 days, and a broken one is dropped", () => {
    saveDraft("form-1", toDraft(filled(), steps, 1, 0));
    expect(loadDraft("form-1", DRAFT_DAYS * DAY - 1)).not.toBeNull();
    expect(loadDraft("form-1", DRAFT_DAYS * DAY + 1)).toBeNull();
    expect(store.getItem(draftKey("form-1"))).toBeNull();
    store.setItem(draftKey("form-2"), "{not json");
    expect(loadDraft("form-2")).toBeNull();
    expect(store.getItem(draftKey("form-2"))).toBeNull();
    saveDraft("form-3", toDraft(filled(), steps, 1));
    clearDraft("form-3");
    expect(loadDraft("form-3")).toBeNull();
  });

  it("FORM-14 storage that throws (private mode) means no draft, not an error", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    vi.stubGlobal("window", { localStorage: broken });
    expect(() => saveDraft("f", toDraft(filled(), steps, 1))).not.toThrow();
    expect(loadDraft("f")).toBeNull();
    expect(() => clearDraft("f")).not.toThrow();
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    expect(loadDraft("f")).toBeNull();
    expect(() => saveDraft("f", toDraft(filled(), steps, 1))).not.toThrow();
  });

  it("FORM-14 only what the form still asks is restored; locked prefills stay; a moved page is found by key", () => {
    const draft = toDraft(filled(), steps, 1);
    draft.answers.gone = { mode: "text", text: "Removed question" };
    (draft.custom as Record<string, unknown>).bad = { evil: true };
    (draft.person as Record<string, unknown>).email = 42;
    const reordered = [steps[0], steps[2], steps[1], ...steps.slice(3)];
    const { state, step } = restoreDraft(draft, fresh({ name: "Locked Name" }), reordered, ["name"]);
    expect(step).toBe(2);
    expect(state.answers.gone).toBeUndefined();
    expect(state.custom).toEqual({ plan: "pro" });
    expect(state.person.name).toBe("Locked Name");
    expect(state.person.email).toBe("");
    // A step that no longer exists lands on the nearest one.
    expect(restoreDraft({ ...draft, step: { index: 99, id: "nope" } }, fresh(), steps).step).toBe(steps.length - 1);
  });

  it("FORM-14 an untouched form (or one with only prefilled details) isn't saved", () => {
    expect(hasContent(fresh())).toBe(false);
    expect(hasContent(fresh({ name: "Pre Filled" }), { name: "Pre Filled" })).toBe(false);
    const s = fresh({ name: "Pre Filled" });
    s.person.name = "Changed";
    expect(hasContent(s, { name: "Pre Filled" })).toBe(true);
    expect(hasContent(filled())).toBe(true);
  });
});
