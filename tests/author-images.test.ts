import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE as removeRoute, POST as uploadRoute } from "@/app/api/admin/testimonials/[id]/author-image/[which]/route";
import { getDb, schema } from "@/db";
import { setAuthorImage } from "@/lib/author-images";
import { listHistory } from "@/lib/history";
import { addManualTestimonial } from "@/lib/manual-add";
import { resolveKey } from "@/lib/storage";
import { createProject, createTestimonial, getProjectById, getTestimonial, isMediaPublic, updateTestimonial } from "@/lib/testimonials";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, params, PNG_BYTES, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  getDb()
    .insert(schema.webhooks)
    .values({ id: "hook", url: "http://127.0.0.1:9/hook", secret: "whsec_x", events: '["testimonial.updated"]', active: true, createdAt: new Date() })
    .run();
});
afterEach(() => {
  delete process.env.MAX_IMAGE_MB;
  ctx.cleanup();
});

const png = (name = "me.png") => new File([PNG_BYTES], name, { type: "image/png" });
const stored = (key: string) => fs.existsSync(resolveKey(key));
const updates = () => getDb().select().from(schema.webhookDeliveries).all().filter((d) => d.event === "testimonial.updated");

function call(method: "POST" | "DELETE", id: string, which: string, file?: File) {
  const url = `http://localhost/api/admin/testimonials/${id}/author-image/${which}`;
  let body: FormData | undefined;
  if (file) {
    body = new FormData();
    body.set("file", file);
  }
  const req = new Request(url, { method, headers: adminHeaders(), body });
  return (method === "POST" ? uploadRoute : removeRoute)(req, params({ id, which }));
}

describe("INBOX-08 photo and company logo", () => {
  it("INBOX-08 upload, replace and remove go through the edit path: history, webhook, old file deleted", async () => {
    const t = createTestimonial(projectId, { name: "Ava Author", text: "Lovely" });
    const first = await setAuthorImage(t.id, "avatar", png(), { by: "owner@example.com" });
    const firstKey = first!.avatarKey!;
    expect(firstKey).toMatch(/^images\/.+\.png$/);
    expect(stored(firstKey)).toBe(true);

    const second = await setAuthorImage(t.id, "avatar", png("again.png"));
    const secondKey = second!.avatarKey!;
    expect(secondKey).not.toBe(firstKey);
    expect(stored(firstKey)).toBe(false);

    const logo = await setAuthorImage(t.id, "logo", png("logo.png"));
    expect(logo!.companyLogoKey).toMatch(/^images\//);
    const removed = await setAuthorImage(t.id, "logo", null);
    expect(removed!.companyLogoKey).toBeNull();
    expect(stored(logo!.companyLogoKey!)).toBe(false);

    const edits = listHistory(t.id).filter((h) => h.action === "edited");
    expect(edits.map((h) => Object.keys(JSON.parse(h.diff)))).toEqual([["avatarKey"], ["avatarKey"], ["companyLogoKey"], ["companyLogoKey"]]);
    expect(edits[0].actorEmail).toBe("owner@example.com");
    expect(JSON.parse(edits[1].diff).avatarKey).toEqual([firstKey, secondKey]);
    expect(updates()).toHaveLength(4);
    // A photo isn't something the author wrote: no "edited after consent".
    expect(getTestimonial(t.id)!.editedAfterConsent).toBe(false);
    // Removing nothing changes nothing.
    await setAuthorImage(t.id, "logo", null);
    expect(updates()).toHaveLength(4);
  });

  it("INBOX-08 the photo is public media once approved, and a file the customer record shares is kept", async () => {
    const t = await addManualTestimonial(getProjectById(projectId)!, { name: "Cy Customer", email: "cy@example.com", text: "Great", status: "pending" }, { avatar: png() });
    const shared = t.avatarKey!;
    const customer = getDb().select().from(schema.customers).all()[0];
    expect(customer.avatarKey).toBe(shared);
    const next = await setAuthorImage(t.id, "avatar", png("new.png"));
    expect(stored(shared)).toBe(true);
    expect(isMediaPublic(next!.avatarKey!)).toBe(false);
    updateTestimonial(t.id, { status: "approved" });
    expect(isMediaPublic(next!.avatarKey!)).toBe(true);
  });

  it("INBOX-08 the route checks the type and size on the server", async () => {
    const t = createTestimonial(projectId, { name: "Rae Route", text: "Hi" });
    const ok = await call("POST", t.id, "logo", png());
    expect(ok.status).toBe(200);
    expect((await ok.json()).testimonial.companyLogoKey).toMatch(/^images\//);

    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "x.png", { type: "image/png" });
    expect((await call("POST", t.id, "avatar", svg)).status).toBe(415);
    process.env.MAX_IMAGE_MB = "0.000001";
    expect((await call("POST", t.id, "avatar", png())).status).toBe(400);
    delete process.env.MAX_IMAGE_MB;
    expect((await call("POST", t.id, "avatar")).status).toBe(400);
    expect((await call("POST", t.id, "banner", png())).status).toBe(404);
    expect((await call("POST", "missing", "avatar", png())).status).toBe(404);
    expect(getTestimonial(t.id)!.avatarKey).toBeNull();
    // Nothing stored for the refused uploads: the only image is the logo.
    const logoKey = getTestimonial(t.id)!.companyLogoKey!;
    expect(fs.readdirSync(path.dirname(resolveKey(logoKey)))).toEqual([path.basename(logoKey)]);

    const del = await call("DELETE", t.id, "logo");
    expect(del.status).toBe(200);
    expect((await del.json()).testimonial.companyLogoKey).toBeNull();
    const anon = await uploadRoute(new Request(`http://localhost/api/admin/testimonials/${t.id}/author-image/avatar`, { method: "POST" }), params({ id: t.id, which: "avatar" }));
    expect(anon.status).toBe(401);
  });
});
