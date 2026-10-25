import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { upsertCustomer } from "@/lib/customers";
import { createProject } from "@/lib/testimonials";
import { useTempDataDir } from "./helpers";

/** One customer per person per project (plan §3.1): matched by email, details only ever filled in. */

const { customers, projects } = schema;

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => ctx.cleanup());

const rows = (id = projectId) => getDb().select().from(customers).where(eq(customers.projectId, id)).all();

describe("upsertCustomer", () => {
  it("adds a customer with a lower-cased email and trimmed details", () => {
    const c = upsertCustomer(projectId, {
      email: "  Ada@Example.COM ",
      name: " Ada Lovelace ",
      title: "CTO",
      company: "  ",
      website: "https://ada.example",
      avatarKey: "images/11111111-1111-4111-8111-111111111111.png",
      socials: { x: "@ada", linkedin: " " },
    })!;
    expect(c).toMatchObject({
      projectId,
      email: "ada@example.com",
      name: "Ada Lovelace",
      title: "CTO",
      company: null,
      website: "https://ada.example",
      avatarKey: "images/11111111-1111-4111-8111-111111111111.png",
    });
    expect(JSON.parse(c.socials)).toEqual({ x: "@ada" });
    expect(c.createdAt).toBeInstanceOf(Date);
    expect(rows()).toHaveLength(1);
  });

  it("finds the same person by email and only fills in blanks", () => {
    const first = upsertCustomer(projectId, { email: "ada@example.com", name: "Ada", company: "Lovelace Ltd", socials: { x: "@ada" } })!;
    const again = upsertCustomer(projectId, {
      email: "ADA@example.com",
      name: "Someone Else",
      title: "Founder",
      company: "Other Co",
      socials: { x: "@other", linkedin: "in/ada" },
    })!;
    expect(again.id).toBe(first.id);
    expect(again).toMatchObject({ name: "Ada", title: "Founder", company: "Lovelace Ltd" });
    expect(JSON.parse(again.socials)).toEqual({ x: "@ada", linkedin: "in/ada" });
    expect(rows()).toHaveLength(1);
    // Nothing new to fill: the row comes back as it is.
    expect(upsertCustomer(projectId, { email: "ada@example.com", name: "Ada" })).toEqual(again);
  });

  it("always adds a new row without an email", () => {
    const a = upsertCustomer(projectId, { name: "Imported Ivy" })!;
    const b = upsertCustomer(projectId, { name: "Imported Ivy", email: "  " })!;
    expect(a.id).not.toBe(b.id);
    expect([a.email, b.email]).toEqual([null, null]);
    expect(rows()).toHaveLength(2);
  });

  it("returns null when there's no name to save", () => {
    expect(upsertCustomer(projectId, { name: "   ", email: "ada@example.com" })).toBeNull();
    expect(rows()).toEqual([]);
  });

  it("keeps each project's customers apart", () => {
    const other = createProject({ name: "Beta", slug: "beta" }).id;
    const a = upsertCustomer(projectId, { email: "ada@example.com", name: "Ada" })!;
    const b = upsertCustomer(other, { email: "ada@example.com", name: "Ada B" })!;
    expect(a.id).not.toBe(b.id);
    expect(rows(other).map((c) => c.name)).toEqual(["Ada B"]);
  });

  it("writes inside the caller's transaction, and rolls back with it", () => {
    const inTx = getDb().transaction((tx) => upsertCustomer(projectId, { email: "tx@example.com", name: "Tess" }, tx));
    expect(inTx?.email).toBe("tx@example.com");
    expect(() =>
      getDb().transaction((tx) => {
        upsertCustomer(projectId, { email: "gone@example.com", name: "Gone" }, tx);
        throw new Error("submission failed");
      }),
    ).toThrow("submission failed");
    expect(rows().map((c) => c.email)).toEqual(["tx@example.com"]);
  });

  it("reads back a row another request added first, without a constraint error", () => {
    const now = new Date();
    getDb()
      .insert(customers)
      .values({ id: "c-race", projectId, email: "race@example.com", name: "Racer", createdAt: now, updatedAt: now })
      .run();
    const c = upsertCustomer(projectId, { email: "race@example.com", name: "Racer Two", company: "Speedy" })!;
    expect(c).toMatchObject({ id: "c-race", name: "Racer", company: "Speedy" });
  });

  it("goes with its project", () => {
    upsertCustomer(projectId, { email: "ada@example.com", name: "Ada" });
    getDb().delete(projects).where(eq(projects.id, projectId)).run();
    expect(rows()).toEqual([]);
  });
});
