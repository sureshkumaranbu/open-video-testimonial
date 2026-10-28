import { eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { NOTIFY_FREQUENCIES } from "@/db/schema";
import { projectAccessFor } from "../access";
import { normalizeEmail, roleFor } from "../members";

const { memberPrefs, members } = schema;

/**
 * One person's email notifications (INT-01), keyed by their lower-cased
 * address. Everything is off until they turn it on (D14), and mail only ever
 * goes to someone who has signed in and may still sign in.
 */
export const prefsSchema = z.object({
  /** New testimonials: one email each, one a day, or none. */
  newTestimonial: z.enum(NOTIFY_FREQUENCIES).default("off"),
  /** Monday: how many testimonials wait for review. */
  weeklyPending: z.boolean().default(false),
  /** When an import finishes, when an automatic import adds reviews, and when one fails 3 times in a row (IMP-02). */
  importSummary: z.boolean().default(false),
  /** The 1st of the month: last month's numbers. */
  monthlyReport: z.boolean().default(false),
  /** A widget that was live hasn't been seen on any page for 7 days (DISP-13). */
  widgetRemoved: z.boolean().default(false),
  /** Only these projects; empty means every project. */
  projectIds: z.array(z.string().min(1).max(64)).max(200).default([]),
});
export type Prefs = z.infer<typeof prefsSchema>;
/** A partial update: no defaults here, so a field left out keeps its saved value. */
export const prefsPatchSchema = z.object({
  newTestimonial: z.enum(NOTIFY_FREQUENCIES),
  weeklyPending: z.boolean(),
  importSummary: z.boolean(),
  monthlyReport: z.boolean(),
  widgetRemoved: z.boolean(),
  projectIds: z.array(z.string().min(1).max(64)).max(200),
}).partial();
export type PrefsPatch = z.infer<typeof prefsPatchSchema>;

export const DEFAULT_PREFS: Prefs = prefsSchema.parse({});

/** Stored prefs; unreadable values fall back to "off" field by field. */
export function parsePrefs(raw: string | null | undefined): Prefs {
  let stored: unknown = {};
  try {
    stored = JSON.parse(raw || "{}");
  } catch {
    stored = {};
  }
  const parsed = prefsSchema.safeParse(stored);
  if (parsed.success) return parsed.data;
  const out: Prefs = { ...DEFAULT_PREFS };
  if (stored && typeof stored === "object") {
    for (const [k, v] of Object.entries(stored)) {
      const one = prefsPatchSchema.safeParse({ [k]: v });
      if (one.success) Object.assign(out, one.data);
    }
  }
  return out;
}

export function getPrefs(email: string): Prefs {
  const row = getDb().select({ n: memberPrefs.notifications }).from(memberPrefs).where(eq(memberPrefs.email, normalizeEmail(email))).get();
  return parsePrefs(row?.n);
}

/**
 * Saves part of the prefs, keeping the rest (and the inbox view prefs). Turning
 * a digest on starts its clock now, so the first one covers only what comes
 * after it rather than mail arriving straight away.
 */
export function setPrefs(email: string, patch: PrefsPatch): Prefs {
  const key = normalizeEmail(email);
  const db = getDb();
  return db.transaction((tx) => {
    const row = tx.select().from(memberPrefs).where(eq(memberPrefs.email, key)).get();
    const before = parsePrefs(row?.notifications);
    const next = prefsSchema.parse({ ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
    const now = new Date();
    const clocks = {
      ...(next.newTestimonial === "daily" && before.newTestimonial !== "daily" ? { lastDigestAt: now } : {}),
      ...(next.weeklyPending && !before.weeklyPending ? { lastWeeklyAt: now } : {}),
      ...(next.monthlyReport && !before.monthlyReport ? { lastMonthlyAt: now } : {}),
    };
    const notifications = JSON.stringify(next);
    if (row) {
      tx.update(memberPrefs).set({ notifications, ...clocks, updatedAt: now }).where(eq(memberPrefs.email, key)).run();
    } else {
      tx.insert(memberPrefs).values({ email: key, notifications, ...clocks, updatedAt: now }).run();
    }
    return next;
  });
}

/**
 * Whether an address may be mailed at all (D14): it has signed in at least
 * once, and it can still sign in (not removed from the team or the server's
 * settings since).
 */
export function canEmail(email: string): boolean {
  const key = normalizeEmail(email);
  const m = getDb().select({ last: members.lastSignInAt }).from(members).where(eq(members.email, key)).get();
  return Boolean(m?.last) && roleFor(key) !== null;
}

export const wantsProject = (p: Prefs, projectId: string | null) => !projectId || p.projectIds.length === 0 || p.projectIds.includes(projectId);

export type Recipient = { email: string; prefs: Prefs; row: typeof memberPrefs.$inferSelect };

/** Everyone who may be mailed and whose prefs pass `want`, from the people who have saved prefs. */
export function recipients(want: (p: Prefs) => boolean): Recipient[] {
  const rows = getDb().select().from(memberPrefs).where(isNotNull(memberPrefs.notifications)).all();
  const out: Recipient[] = [];
  for (const row of rows) {
    const prefs = parsePrefs(row.notifications);
    if (!canEmail(row.email)) continue;
    // TEAM-01: someone limited to some projects only hears about those.
    const access = projectAccessFor(row.email, roleFor(row.email)!);
    const own = access.all ? prefs : { ...prefs, projectIds: (prefs.projectIds.length ? prefs.projectIds.filter((id) => access.ids.has(id)) : [...access.ids]).concat("-") };
    if (!want(own)) continue;
    out.push({ email: row.email, prefs: own, row });
  }
  return out;
}
