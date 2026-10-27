import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/projects/[slug]/testimonials/route";
import { getDefaultForm, updateForm } from "@/lib/forms";
import { parseFormRow } from "@/lib/forms/schema";
import { createProject, getTestimonial, listTestimonials, updateProject } from "@/lib/testimonials";
import { params, PNG_BYTES, submissionForm, submitRequest, useTempDataDir, WEBM_BYTES } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => ctx.cleanup());

const base = { name: "Ada Lovelace", consent: "on" };

describe("POST /api/projects/:slug/testimonials", () => {
  it("stores a text testimonial as pending", async () => {
    const res = await POST(
      submitRequest(
        "acme",
        submissionForm({
          ...base,
          email: "ada@example.com",
          title: "CTO",
          company: "Engines Ltd",
          rating: "5",
          text: "Saved us hours every week.",
        }),
      ),
      params({ slug: "acme" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message).toMatch(/thank you/i);

    const saved = getTestimonial(body.id)!;
    expect(saved).toMatchObject({
      projectId,
      status: "pending",
      authorName: "Ada Lovelace",
      authorEmail: "ada@example.com",
      authorTitle: "CTO",
      authorCompany: "Engines Ltd",
      rating: 5,
      text: "Saved us hours every week.",
      videoKey: null,
    });
    expect(saved.consentAt).toBeInstanceOf(Date);
  });

  it("stores an uploaded video and avatar on disk", async () => {
    const res = await POST(
      submitRequest(
        "acme",
        submissionForm({
          ...base,
          video: new File([WEBM_BYTES], "clip.webm", { type: "video/webm" }),
          avatar: new File([PNG_BYTES], "me.png", { type: "image/png" }),
        }),
      ),
      params({ slug: "acme" }),
    );
    expect(res.status).toBe(201);
    const saved = getTestimonial((await res.json()).id)!;
    expect(saved.videoKey).toMatch(/^videos\/[0-9a-f-]{36}\.webm$/);
    expect(saved.videoMime).toBe("video/webm");
    expect(saved.avatarKey).toMatch(/^images\/[0-9a-f-]{36}\.png$/);
    expect(fs.existsSync(path.join(ctx.dir, "uploads", saved.videoKey!))).toBe(true);
  });

  it("still refuses a photo that isn't an image we accept, whatever the browser checked", async () => {
    const res = await POST(
      submitRequest(
        "acme",
        submissionForm({ ...base, text: "Great", avatar: new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "me.png", { type: "image/png" }) }),
      ),
      params({ slug: "acme" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("This photo isn't a format we can use. Choose a PNG, JPEG, WebP or GIF image.");
  });

  it("rejects files whose content isn't really video, whatever the declared type", async () => {
    const res = await POST(
      submitRequest(
        "acme",
        submissionForm({
          ...base,
          video: new File(["<html><script>alert(1)</script>"], "x.webm", { type: "video/webm" }),
        }),
      ),
      params({ slug: "acme" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/isn.t a video we can use/);
    expect(listTestimonials(projectId)).toHaveLength(0);
  });

  it("requires consent", async () => {
    const res = await POST(
      submitRequest("acme", submissionForm({ name: "Ada", text: "Great" })),
      params({ slug: "acme" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/consent/i);
  });

  it("requires either text or a video", async () => {
    const res = await POST(submitRequest("acme", submissionForm(base)), params({ slug: "acme" }));
    expect(res.status).toBe(400);
  });

  it("validates rating range and email", async () => {
    const cases: Record<string, string>[] = [{ rating: "6", text: "x" }, { email: "not-an-email", text: "x" }];
    for (const extra of cases) {
      const res = await POST(
        submitRequest("acme", submissionForm({ ...base, ...extra })),
        params({ slug: "acme" }),
      );
      expect(res.status).toBe(400);
    }
  });

  it("ignores text when the project only accepts video", async () => {
    updateProject(projectId, { allowText: false });
    const res = await POST(
      submitRequest("acme", submissionForm({ ...base, text: "Only text" })),
      params({ slug: "acme" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/video/i);
  });

  it("silently drops honeypot submissions", async () => {
    const res = await POST(
      submitRequest("acme", submissionForm({ ...base, text: "spam", website: "http://spam" })),
      params({ slug: "acme" }),
    );
    expect(res.status).toBe(200);
    expect(listTestimonials(projectId)).toHaveLength(0);
  });

  it("returns 404 for an unknown project", async () => {
    const res = await POST(
      submitRequest("nope", submissionForm({ ...base, text: "x" })),
      params({ slug: "nope" }),
    );
    expect(res.status).toBe(404);
  });

  it("rate-limits repeated submissions from one IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await POST(
        submitRequest("acme", submissionForm({ ...base, text: `#${i}` }), "198.51.100.1"),
        params({ slug: "acme" }),
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("the classic endpoint and the default form's rules", () => {
  it("FORM-10 auto-tags and the per-IP cap of the default form apply to classic submissions", async () => {
    const form = getDefaultForm(projectId);
    const cfg = parseFormRow(form);
    updateForm(form.id, { settings: { ...cfg.settings, autoTags: ["classic"], maxPerIpPerDay: 1 } });
    const send = (ip: string) => POST(submitRequest("acme", submissionForm({ ...base, text: "Hi" }), ip), params({ slug: "acme" }));
    const res = await send("192.0.2.50");
    expect(res.status).toBe(201);
    expect(getTestimonial((await res.json()).id)?.tags).toEqual(["classic"]);
    expect((await send("192.0.2.50")).status).toBe(429);
  });
});
