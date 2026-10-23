import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/admin/login/route";
import { GET as getProject } from "@/app/api/admin/projects/[id]/route";
import { POST as createProjectRoute } from "@/app/api/admin/projects/route";
import { DELETE, PATCH } from "@/app/api/admin/testimonials/[id]/route";
import { createSessionToken, verifySessionToken } from "@/lib/auth";
import { createProject, createTestimonial, getTestimonial } from "@/lib/testimonials";
import { ADMIN_EMAIL, ADMIN_PASSWORD, adminHeaders, params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;
let testimonialId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  testimonialId = createTestimonial(projectId, { name: "Grace", text: "Brilliant" }).id;
});
afterEach(() => ctx.cleanup());

function patch(id: string, body: unknown, headers: Record<string, string> = { ...adminHeaders() }) {
  return PATCH(
    new Request(`http://localhost/api/admin/testimonials/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", host: "localhost", ...headers },
      body: JSON.stringify(body),
    }),
    params({ id }),
  );
}

describe("admin auth", () => {
  it("signs in with the configured owner credentials", async () => {
    const res = await login(
      new Request("http://localhost/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ email: ADMIN_EMAIL.toUpperCase(), password: ADMIN_PASSWORD }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^plaudit_session_[0-9a-f]{8}=.+HttpOnly; SameSite=Lax/);
  });

  it("rejects a wrong password", async () => {
    const res = await login(
      new Request("http://localhost/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ email: ADMIN_EMAIL, password: "nope" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects tampered and expired session tokens", () => {
    const token = createSessionToken(ADMIN_EMAIL);
    expect(verifySessionToken(token)).toEqual({ email: ADMIN_EMAIL });
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "x", exp: Date.now() + 1e9 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`)).toBeNull();
    expect(verifySessionToken(`${payload}.AAAA`)).toBeNull();
    expect(verifySessionToken(createSessionToken(ADMIN_EMAIL, "password", 0))).toBeNull();
  });
});

describe("moderation", () => {
  it("requires a session", async () => {
    const res = await patch(testimonialId, { status: "approved" }, {});
    expect(res.status).toBe(401);
    expect(getTestimonial(testimonialId)!.status).toBe("pending");
  });

  it("blocks cross-origin requests even with a session cookie", async () => {
    const res = await patch(
      testimonialId,
      { status: "approved" },
      { ...adminHeaders(), origin: "https://evil.example" },
    );
    expect(res.status).toBe(403);
  });

  it("requires the browser to vouch for the origin of cookie-authenticated changes", async () => {
    const cookie = adminHeaders().cookie;
    // No Origin and no Sec-Fetch-Site: refused, even with a valid session.
    expect((await patch(testimonialId, { status: "approved" }, { cookie })).status).toBe(403);
    expect((await patch(testimonialId, { status: "approved" }, { cookie, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await patch(testimonialId, { status: "approved" }, { cookie, "sec-fetch-site": "same-site" })).status).toBe(403);
    expect(getTestimonial(testimonialId)!.status).toBe("pending");
    // A matching Origin, or Sec-Fetch-Site: same-origin, is accepted.
    expect((await patch(testimonialId, { status: "approved" }, { cookie, origin: "http://localhost" })).status).toBe(200);
    expect((await patch(testimonialId, { status: "rejected" }, { cookie, "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect(getTestimonial(testimonialId)!.status).toBe("rejected");
  });

  it("approves and rejects", async () => {
    expect((await patch(testimonialId, { status: "approved" })).status).toBe(200);
    expect(getTestimonial(testimonialId)!.status).toBe("approved");
    expect((await patch(testimonialId, { status: "rejected" })).status).toBe(200);
    expect(getTestimonial(testimonialId)!.status).toBe("rejected");
  });

  it("rejects an unknown status", async () => {
    expect((await patch(testimonialId, { status: "published" })).status).toBe(400);
  });

  it("edits the display name and replaces tags", async () => {
    let res = await patch(testimonialId, { authorName: "Grace H.", tags: ["Homepage", "pricing", "homepage"] });
    expect(res.status).toBe(200);
    expect((await res.json()).testimonial).toMatchObject({ authorName: "Grace H.", tags: ["homepage", "pricing"] });
    res = await patch(testimonialId, { tags: ["pricing"] });
    expect(getTestimonial(testimonialId)!.tags).toEqual(["pricing"]);
  });

  it("deletes", async () => {
    const res = await DELETE(
      new Request(`http://localhost/api/admin/testimonials/${testimonialId}`, {
        method: "DELETE",
        headers: { ...adminHeaders() },
      }),
      params({ id: testimonialId }),
    );
    expect(res.status).toBe(200);
    expect(getTestimonial(testimonialId)).toBeNull();
  });

  it("lists testimonials filtered by status, including private fields", async () => {
    createTestimonial(projectId, { name: "Linus", email: "l@example.com", text: "Solid" });
    await patch(testimonialId, { status: "approved" });
    const res = await getProject(
      new Request(`http://localhost/api/admin/projects/${projectId}?status=pending`, {
        headers: { ...adminHeaders() },
      }),
      params({ id: projectId }),
    );
    const body = await res.json();
    expect(body.testimonials).toHaveLength(1);
    expect(body.testimonials[0]).toMatchObject({ authorName: "Linus", authorEmail: "l@example.com" });
  });
});

describe("projects", () => {
  it("creates a project and refuses duplicate slugs", async () => {
    const make = (slug: string) =>
      createProjectRoute(
        new Request("http://localhost/api/admin/projects", {
          method: "POST",
          headers: { ...adminHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ name: "Beta", slug }),
        }),
      );
    expect((await make("beta")).status).toBe(201);
    expect((await make("beta")).status).toBe(409);
    expect((await make("Not A Slug!")).status).toBe(400);
  });
});
