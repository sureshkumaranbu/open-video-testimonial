import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/db";
import type { Customer } from "@/db/schema";

/**
 * Customers: one row per person per project, so repeat testimonials share
 * their details. A person is matched by email (lower-cased); without one,
 * every call adds a new row, because there's nothing safe to match on.
 */

const { customers } = schema;

export type CustomerInput = {
  /** Lower-cased before it's stored; without one a new row is always added. */
  email?: string;
  name: string;
  title?: string;
  company?: string;
  website?: string;
  avatarKey?: string;
  socials?: Record<string, string>;
};

const clean = (v: string | null | undefined) => v?.trim() || null;

/** The handles worth keeping: trimmed, non-empty strings. */
function cleanSocials(socials: Record<string, unknown> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(socials ?? {}).flatMap(([k, v]) => (typeof v === "string" && v.trim() ? [[k, v.trim()]] : [])),
  );
}

function readSocials(raw: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? cleanSocials(value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Finds the project's customer by email or adds one. Only fills blanks:
 * details already saved are never overwritten (a later testimonial can't
 * rename someone or swap their photo). Null when there's no name to save.
 * Race-safe: a second insert for the same email does nothing and the row is
 * read back.
 */
export function upsertCustomer(projectId: string, p: CustomerInput, tx?: Tx): Customer | null {
  const db = tx ?? getDb();
  const name = clean(p.name);
  if (!name) return null;
  const email = clean(p.email)?.toLowerCase() ?? null;
  const details = {
    title: clean(p.title),
    company: clean(p.company),
    website: clean(p.website),
    avatarKey: clean(p.avatarKey),
  };
  const socials = cleanSocials(p.socials);
  const now = new Date();
  const values = { id: crypto.randomUUID(), projectId, email, name, ...details, socials: JSON.stringify(socials), createdAt: now, updatedAt: now };

  if (!email) return db.insert(customers).values(values).returning().get();

  const find = () => db.select().from(customers).where(and(eq(customers.projectId, projectId), eq(customers.email, email))).get();
  const existing = find();
  if (!existing) {
    const added = db.insert(customers).values(values).onConflictDoNothing().returning().get();
    if (added) return added;
  }
  const row = existing ?? find();
  if (!row) return null;

  const blanks: Partial<Customer> = {};
  for (const key of ["title", "company", "website", "avatarKey"] as const) {
    if (!row[key] && details[key]) blanks[key] = details[key];
  }
  const saved = readSocials(row.socials);
  const added = Object.entries(socials).filter(([k]) => !saved[k]);
  if (added.length) blanks.socials = JSON.stringify({ ...saved, ...Object.fromEntries(added) });
  if (!Object.keys(blanks).length) return row;
  return db.update(customers).set({ ...blanks, updatedAt: now }).where(eq(customers.id, row.id)).returning().get() ?? row;
}
