import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE as resetRoute, GET as draftGet, PUT as draftPut } from "@/app/api/admin/testimonials/[id]/social-draft/route";
import { POST as rewriteRoute } from "@/app/api/admin/testimonials/[id]/social-draft/rewrite/route";
import { getDb, schema } from "@/db";
import { quotedFrom, setAiStub } from "@/lib/ai";
import { getSocialDraft, MAX_DRAFT_CHARS, shareLinks, shortQuote, templateDraft } from "@/lib/commerce/social";
import { createProject, createTestimonial, getTestimonial, updateTestimonial } from "@/lib/testimonials";
import { createWebhook } from "@/lib/webhook-admin";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, params, useTempDataDir } from "./helpers";

/** INT-08 (M18): a social post draft for each approved testimonial, its share links, Rewrite with AI and the webhook field. */

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

const WORDS =
  "Plaudit changed how we collect stories. We had three testimonials in a year; now we get ten a week, and the video ones convert best on our pricing page. The team loves the inbox too, honestly more than I expected.";

function make(o: { text?: string; title?: string; company?: string } = {}) {
  return createTestimonial(projectId, { name: "Ada Lovelace", title: o.title ?? "CTO", company: o.company ?? "Acme", text: o.text ?? WORDS, consentPublic: true }, { source: "api" });
}
const approve = (id: string) => updateTestimonial(id, { status: "approved" });
const req = (url: string, body?: unknown, method = body === undefined ? "GET" : "PUT") =>
  new Request(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { ...adminHeaders(), "content-type": "application/json" } });

beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  setAiStub(null);
  delete process.env.PLAUDIT_FEATURES;
  ctx.cleanup();
});

describe("INT-08 social post drafts", () => {
  it("INT-08 approving makes a draft: a short quote in the customer's own words, their name and role, within X's limit with the link", () => {
    const t = make();
    expect(getSocialDraft(t.id)).toBeNull();
    approve(t.id);
    const d = getSocialDraft(t.id)!;
    expect(d.text.length).toBeLessThanOrEqual(MAX_DRAFT_CHARS);
    expect(MAX_DRAFT_CHARS + 1 + 23).toBe(280);
    expect(d.text).toMatch(/^“Plaudit changed how we collect stories\./);
    expect(d.text.endsWith("\n— Ada Lovelace, CTO at Acme")).toBe(true);
    const quote = d.text.slice(1, d.text.indexOf("”"));
    expect(quotedFrom(quote, WORDS)).toBe(true);
    expect(d.editedBy).toBeNull();
  });

  it("INT-08 the quote is whole sentences when they fit, else whole words and an ellipsis; a company alone is the role", () => {
    expect(shortQuote("One. Two two. Three three three.", 15)).toBe("One. Two two.");
    expect(shortQuote("A sentence that is far too long to fit", 20)).toBe("A sentence that is…");
    expect(templateDraft({ text: "Great.", transcript: null, headline: null, authorName: "Sam", authorTitle: null, authorCompany: "Beta" })).toBe("“Great.”\n— Sam, Beta");
    // A video-only testimonial quotes its transcript.
    expect(templateDraft({ text: null, transcript: "Loved it.", headline: null, authorName: "Sam", authorTitle: null, authorCompany: null })).toBe("“Loved it.”\n— Sam");
  });

  it("INT-08 the share links are each site's own share page, with no API and no tokens", () => {
    const links = shareLinks("“Great” — Sam", "https://plaudit.example/t/abc");
    expect(links.x).toBe("https://x.com/intent/tweet?text=%E2%80%9CGreat%E2%80%9D%20%E2%80%94%20Sam&url=https%3A%2F%2Fplaudit.example%2Ft%2Fabc");
    expect(links.linkedin).toBe("https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fplaudit.example%2Ft%2Fabc");
  });

  it("INT-08 the testimonial.approved webhook carries the draft as an additive socialDraft field", () => {
    createWebhook({ url: "https://hooks.example/approved", events: ["testimonial.approved"], projectId: null, formId: null, active: true });
    const t = make();
    approve(t.id);
    const [delivery] = getDb().select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.event, "testimonial.approved")).all();
    const body = JSON.parse(delivery.payload);
    expect(body.data.testimonial.id).toBe(t.id);
    expect(body.data.socialDraft).toMatchObject({
      text: getSocialDraft(t.id)!.text,
      url: `http://localhost:3000/t/${t.id}`,
      post: expect.stringContaining(`\n\nhttp://localhost:3000/t/${t.id}`),
      shareUrls: { x: expect.stringMatching(/^https:\/\/x\.com\/intent\/tweet\?text=/), linkedin: expect.stringMatching(/^https:\/\/www\.linkedin\.com\/sharing\/share-offsite\/\?url=/) },
      clip: null,
    });
  });

  it("INT-08 with the commerce flag off there's no draft, no webhook field and no route", async () => {
    process.env.PLAUDIT_FEATURES = "forms,inbox2,widgets";
    createWebhook({ url: "https://hooks.example/approved", events: ["testimonial.approved"], projectId: null, formId: null, active: true });
    const t = make();
    approve(t.id);
    expect(getSocialDraft(t.id)).toBeNull();
    const [delivery] = getDb().select().from(schema.webhookDeliveries).all();
    expect(JSON.parse(delivery.payload).data.socialDraft).toBeUndefined();
    expect((await draftGet(req(`/api/admin/testimonials/${t.id}/social-draft`), params({ id: t.id }))).status).toBe(404);
  });

  it("INT-08 the drawer's panel: made for older approvals, saved by an editor, back to the template, and only once it's approved", async () => {
    const t = make();
    const url = `/api/admin/testimonials/${t.id}/social-draft`;
    expect((await draftGet(req(url), params({ id: t.id }))).status).toBe(409);
    // Approved before M18 (no draft row): the first look makes one.
    updateTestimonial(t.id, { status: "approved" }, { quiet: true });
    getDb().delete(schema.socialDrafts).run();
    const got = await (await draftGet(req(url), params({ id: t.id }))).json();
    expect(got.draft).toMatchObject({ text: expect.stringMatching(/^“/), edited: false, url: `http://localhost:3000/t/${t.id}` });
    expect(got.ai).toBe(false);

    const saved = await (await draftPut(req(url, { text: "Ten stories a week. Thanks, Ada!" }), params({ id: t.id }))).json();
    expect(saved.draft).toMatchObject({ text: "Ten stories a week. Thanks, Ada!", edited: true, post: `Ten stories a week. Thanks, Ada!\n\nhttp://localhost:3000/t/${t.id}` });
    expect(getSocialDraft(t.id)!.editedBy).toBe("owner@example.com");
    expect((await draftPut(req(url, { text: "x".repeat(MAX_DRAFT_CHARS + 1) }), params({ id: t.id }))).status).toBe(400);

    const reset = await (await resetRoute(req(url, undefined, "DELETE"), params({ id: t.id }))).json();
    expect(reset.draft.edited).toBe(false);
    expect(reset.draft.text).toBe(templateDraft(getTestimonial(t.id)!));
  });

  it("INT-08 L25 saving or resetting a draft sends testimonial.social_draft_updated to hooks that ticked it, with the draft as it is now", async () => {
    createWebhook({ url: "https://hooks.example/drafts", events: ["testimonial.social_draft_updated"], projectId: null, formId: null, active: true });
    createWebhook({ url: "https://hooks.example/default", events: [], projectId: null, formId: null, active: true });
    const t = make();
    approve(t.id);
    const url = `/api/admin/testimonials/${t.id}/social-draft`;
    await draftPut(req(url, { text: "Ten stories a week." }), params({ id: t.id }));
    await resetRoute(req(url, undefined, "DELETE"), params({ id: t.id }));
    const sent = getDb().select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.event, "testimonial.social_draft_updated")).all();
    // Opt-in: only the hook that ticked it, once per save.
    expect(sent).toHaveLength(2);
    const [saved, reset] = sent.map((d) => JSON.parse(d.payload));
    expect(saved).toMatchObject({ event: "testimonial.social_draft_updated", project: { slug: "acme" }, data: { testimonial: { id: t.id }, socialDraft: { text: "Ten stories a week.", edited: true, url: `http://localhost:3000/t/${t.id}`, post: `Ten stories a week.\n\nhttp://localhost:3000/t/${t.id}` } } });
    expect(reset.data.socialDraft).toMatchObject({ text: templateDraft(getTestimonial(t.id)!), edited: false });
  });

  it("INT-08 a ready social clip from M16 is offered with the draft", async () => {
    const t = make();
    approve(t.id);
    getDb()
      .insert(schema.videoRenders)
      .values({ id: crypto.randomUUID(), projectId, testimonialId: t.id, kind: "social", status: "ready", key: "renders/clip.mp4", width: 1080, height: 1920, createdAt: new Date(), updatedAt: new Date() })
      .run();
    const got = await (await draftGet(req(`/api/admin/testimonials/${t.id}/social-draft`), params({ id: t.id }))).json();
    expect(got.draft.clip).toMatchObject({ url: "http://localhost:3000/api/media/renders/clip.mp4", width: 1080, height: 1920 });
  });
});

describe("INT-08 Rewrite with AI", () => {
  const rewrite = (id: string) => rewriteRoute(req(`/api/admin/testimonials/${id}/social-draft/rewrite`, undefined, "POST"), params({ id }));

  it("INT-08 with AI off for the project it's the template only (409)", async () => {
    const t = make();
    approve(t.id);
    const res = await rewrite(t.id);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/AI isn't on/);
  });

  it("INT-08 a rewrite must quote the customer word for word, and is a suggestion (nothing saved)", async () => {
    const t = make();
    approve(t.id);
    const before = getSocialDraft(t.id)!.text;
    const sent: string[] = [];
    setAiStub((r) => {
      sent.push(r.user);
      return { text: "Ten a week instead of three a year: “now we get ten a week, and the video ones convert best on our pricing page.” — Ada Lovelace", quote: "now we get ten a week, and the video ones convert best on our pricing page." };
    });
    const ok = await (await rewrite(t.id)).json();
    expect(ok.suggestion.text).toMatch(/^Ten a week/);
    expect(sent[0]).toContain(WORDS);
    expect(getSocialDraft(t.id)!.text).toBe(before);

    setAiStub(() => ({ text: "“Plaudit doubled our revenue.” — Ada", quote: "Plaudit doubled our revenue." }));
    const made = await rewrite(t.id);
    expect(made.status).toBe(422);
    expect((await made.json()).error).toMatch(/customer's own words/);

    setAiStub(() => ({ text: "Great product, says Ada.", quote: "The team loves the inbox too" }));
    expect((await rewrite(t.id)).status).toBe(422);

    setAiStub(() => "not json");
    expect((await rewrite(t.id)).status).toBe(502);
    const log = getDb().select().from(schema.auditLog).where(eq(schema.auditLog.action, "social_draft.ai_rewrite")).all();
    expect(log.length).toBeGreaterThanOrEqual(3);
  });
});
