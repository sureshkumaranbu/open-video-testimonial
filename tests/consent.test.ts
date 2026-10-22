import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PATCH } from "@/app/api/admin/testimonials/[id]/route";
import { GET as consentRecord } from "@/app/api/admin/testimonials/[id]/consent/route";
import { POST as submit } from "@/app/api/projects/[slug]/testimonials/route";
import { POST as withdraw } from "@/app/api/withdraw/[token]/route";
import { GET as widget } from "@/app/api/widget/[slug]/route";
import { currentConsentVersion, DEFAULT_CONSENT, listConsentEvents, listConsentVersions } from "@/lib/consent";
import { createProject, getProjectById, getTestimonial, updateProject } from "@/lib/testimonials";
import { adminCookie, params, submissionForm, submitRequest, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  delete process.env.CONSENT_IP_HASH;
  ctx.cleanup();
});

const project = () => getProjectById(projectId)!;

async function send(fields: Record<string, string> = {}, ip = "203.0.113.50") {
  const res = await submit(
    submitRequest("acme", submissionForm({ name: "Ada", text: "Great", consent: "on", ...fields }), ip),
    params({ slug: "acme" }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; withdrawUrl: string };
}

function adminPatch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/admin/testimonials/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { cookie: adminCookie() },
    }),
    params({ id }),
  );
}

function withdrawWith(url: string) {
  const token = url.split("/w/")[1];
  return withdraw(
    new Request(`http://localhost/api/withdraw/${token}`, { method: "POST", headers: { "x-forwarded-for": "203.0.113.51" } }),
    params({ token }),
  );
}

describe("consent ledger", () => {
  it("records the exact wording, its hash and the scopes with each submission", async () => {
    const version = currentConsentVersion(project());
    expect(version).toMatchObject({ version: 1, text: DEFAULT_CONSENT.replace("{project}", "Acme") });
    expect(version.hash).toMatch(/^[0-9a-f]{64}$/);

    const { id, withdrawUrl } = await send({ consentVersion: version.id, consentSocial: "on" });
    expect(withdrawUrl).toMatch(/^http:\/\/localhost:3000\/w\/[\w-]{32}$/);
    const t = getTestimonial(id)!;
    expect(JSON.parse(t.consentScopes)).toEqual(["website", "social"]);
    const [event] = listConsentEvents(id);
    expect(event).toMatchObject({
      type: "granted",
      actor: "customer",
      versionId: version.id,
      text: version.text,
      textHash: version.hash,
      scopes: '["website","social"]',
      ipHash: null,
    });
  });

  it("versions the wording and keeps the version each person saw", async () => {
    const v1 = currentConsentVersion(project());
    updateProject(projectId, { consentText: "{project} may quote me anywhere." });
    const v2 = currentConsentVersion(project());
    expect(v2).toMatchObject({ version: 2, text: "Acme may quote me anywhere." });
    expect(currentConsentVersion(project()).id).toBe(v2.id); // unchanged wording, same version

    // Someone who loaded the form before the change agreed to v1.
    const early = await send({ consentVersion: v1.id });
    expect(listConsentEvents(early.id)[0]).toMatchObject({ versionId: v1.id, text: v1.text });
    // No (or a foreign) version id falls back to the current wording.
    const other = createProject({ name: "Other", slug: "other" });
    const foreign = currentConsentVersion(other);
    const late = await send({ consentVersion: foreign.id });
    expect(listConsentEvents(late.id)[0]).toMatchObject({ versionId: v2.id });
    expect(listConsentVersions(projectId).map((v) => v.version)).toEqual([1, 2]);
  });

  it("logs edits to what the author wrote, but not moderation or tags", async () => {
    const { id } = await send();
    await adminPatch(id, { status: "approved", tags: ["home"] });
    expect(getTestimonial(id)!.editedAfterConsent).toBe(false);

    await adminPatch(id, { authorName: "Ada L.", text: "Great!" });
    const t = getTestimonial(id)!;
    expect(t.editedAfterConsent).toBe(true);
    const events = listConsentEvents(id);
    expect(events.map((e) => e.type)).toEqual(["granted", "edited"]);
    expect(events[1]).toMatchObject({ actor: "owner", detail: "Changed after consent: text, authorName" });

    const record = await (
      await consentRecord(new Request(`http://localhost/x`, { headers: { cookie: adminCookie() } }), params({ id }))
    ).json();
    expect(record).toMatchObject({ scopes: ["website"], editedAfterConsent: true });
    expect(record.events).toHaveLength(2);
  });

  it("lets the author withdraw with their private link, for good", async () => {
    const { id, withdrawUrl } = await send();
    await adminPatch(id, { status: "approved" });
    const feed = async () =>
      (await (await widget(new Request("http://localhost/api/widget/acme"), params({ slug: "acme" }))).json()).testimonials;
    expect(await feed()).toHaveLength(1);

    const res = await withdrawWith(withdrawUrl);
    expect(await res.json()).toEqual({ ok: true, alreadyWithdrawn: false });
    const t = getTestimonial(id)!;
    expect(t.status).toBe("rejected");
    expect(t.withdrawnAt).toBeInstanceOf(Date);
    expect(await feed()).toHaveLength(0);
    expect(listConsentEvents(id).map((e) => [e.type, e.actor])).toEqual([
      ["granted", "customer"],
      ["withdrawn", "customer"],
    ]);

    // The owner can't publish it again.
    const again = await adminPatch(id, { status: "approved" });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toMatch(/withdrew consent/);
    expect((await adminPatch(id, { status: "pending" })).status).toBe(409);

    // Withdrawing twice is harmless and logged once.
    expect(await (await withdrawWith(withdrawUrl)).json()).toEqual({ ok: true, alreadyWithdrawn: true });
    expect(listConsentEvents(id)).toHaveLength(2);
  });

  it("rejects unknown withdrawal links", async () => {
    expect((await withdrawWith("http://x/w/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).status).toBe(404);
    expect((await withdrawWith("http://x/w/short")).status).toBe(404);
  });

  it("stores a keyed IP hash only when CONSENT_IP_HASH=true", async () => {
    process.env.CONSENT_IP_HASH = "true";
    const a = await send({}, "198.51.100.1");
    const b = await send({}, "198.51.100.1");
    const hash = listConsentEvents(a.id)[0].ipHash;
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).not.toContain("198.51");
    expect(listConsentEvents(b.id)[0].ipHash).toBe(hash);
  });
});
