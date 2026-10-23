import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { POST as createKeyRoute } from "@/app/api/admin/api-keys/route";
import { POST as createProjectRoute } from "@/app/api/admin/projects/route";
import { PATCH as patchTestimonial } from "@/app/api/admin/testimonials/[id]/route";
import { createProject, createTestimonial } from "@/lib/testimonials";
import { firstIssue, friendlyIssue, projectSchema, submissionSchema, testimonialUpdateSchema } from "@/lib/validation";
import { adminHeaders, params, useTempDataDir } from "./helpers";

const message = (schema: z.ZodType, value: unknown) => {
  const r = schema.safeParse(value);
  if (r.success) throw new Error("expected a validation error");
  return firstIssue(r.error);
};

const RAW_ZOD = /Too small|Too big|Invalid input|Invalid option|expected (string|number|one of)/;

describe("friendly validation messages", () => {
  it("replaces the messages QA saw with field-specific ones", () => {
    expect(message(projectSchema, { name: "", slug: "acme" })).toBe("Name can't be empty");
    expect(message(testimonialUpdateSchema, { rating: 9 })).toBe("Rating must be a whole number from 1 to 5");
    expect(message(testimonialUpdateSchema, { status: "published" })).toBe("Status must be pending, approved or rejected");
    expect(message(projectSchema, { name: "A", slug: "x" })).toBe("Link slug must be at least 2 characters");
    expect(message(projectSchema, { name: "A".repeat(81), slug: "acme" })).toBe("Name can be at most 80 characters");
    expect(message(z.object({ name: z.string() }), null)).toBe("The request body must be a JSON object");
    expect(message(z.object({ name: z.string() }), {})).toBe("Name is required");
    expect(message(z.object({ webhookEvents: z.array(z.string()).max(1) }), { webhookEvents: ["a", "b"] })).toBe(
      "Webhook events can have at most 1 item",
    );
    expect(message(z.object({ email: z.email() }), { email: "nope" })).toBe("Email must be a valid email address");
  });

  it("keeps messages written into a schema", () => {
    expect(message(submissionSchema, { name: "", consent: "on" })).toBe("Please enter your name");
    expect(message(projectSchema, { name: "A", slug: "Bad Slug!" })).toBe("Use lowercase letters, numbers and dashes");
  });

  it("never falls back to Zod's developer wording", () => {
    const codes = ["too_small", "too_big", "invalid_type", "invalid_value", "invalid_format", "invalid_union", "custom"];
    for (const code of codes) expect(friendlyIssue({ code, path: ["thing"] })).not.toMatch(RAW_ZOD);
  });
});

describe("friendly messages reach API responses", () => {
  let ctx: ReturnType<typeof useTempDataDir>;
  beforeEach(() => {
    ctx = useTempDataDir();
  });
  afterEach(() => ctx.cleanup());

  const post = (url: string, body: unknown, method = "POST") =>
    new Request(`http://localhost${url}`, {
      method,
      headers: { ...adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("for projects, API keys and testimonials", async () => {
    const project = await createProjectRoute(post("/api/admin/projects", { name: "", slug: "acme" }));
    expect(await project.json()).toEqual({ error: "Name can't be empty" });
    const key = await createKeyRoute(post("/api/admin/api-keys", { name: "Zap", scope: "admin" }));
    expect(await key.json()).toEqual({ error: "Access must be read or write" });
    const id = createTestimonial(createProject({ name: "Acme", slug: "acme" }).id, { name: "Ada", text: "Hi" }).id;
    const t = await patchTestimonial(post(`/api/admin/testimonials/${id}`, { rating: 9 }, "PATCH"), params({ id }));
    expect(await t.json()).toEqual({ error: "Rating must be a whole number from 1 to 5" });
  });
});
