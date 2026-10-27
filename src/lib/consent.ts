import crypto from "node:crypto";
import { and, asc, desc, eq, max } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ConsentEventType, HistoryActor, Project } from "@/db/schema";
import { env } from "./env";
import { recordHistory } from "./history";

const { consentVersions, consentEvents, testimonials } = schema;

/**
 * The consent ledger. It records what the person agreed to, when, and which
 * wording they saw. Edits by the owner and withdrawals are logged, and rows
 * are only ever added. The owner of a self-hosted instance is the data
 * controller, so this is their audit trail.
 */
export const DEFAULT_CONSENT =
  "I agree that {project} may publish this testimonial, with my name, photo and video, on its website and marketing.";

/**
 * "website" is what the required checkbox grants; the rest are optional
 * extras. A form offers social by default; ads, name and face only when the
 * owner adds them to the form (D12).
 */
export const CONSENT_SCOPES = ["website", "social", "ads", "name", "face"] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export const SCOPE_LABELS: Record<ConsentScope, string> = {
  website: "Website and marketing",
  social: "Social media posts",
  ads: "Paid advertising",
  name: "Showing my full name",
  face: "Showing my face",
};

type Actor = (typeof schema.CONSENT_ACTORS)[number];

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** The wording exactly as the customer sees it. */
export function consentWording(project: Pick<Project, "consentText" | "name">) {
  return (project.consentText.trim() || DEFAULT_CONSENT).replaceAll("{project}", project.name);
}

/**
 * A wording as a stored version of the project's consent: the version that
 * already has exactly this wording (each form can word it differently, and an
 * owner may switch back), or a new one. Previews of unsaved wording use
 * consentWording() instead, so they never add versions (D12).
 */
export function currentConsentVersionFor(project: Pick<Project, "id">, wording: string) {
  const db = getDb();
  const hash = sha256(wording);
  const known = db
    .select()
    .from(consentVersions)
    .where(and(eq(consentVersions.projectId, project.id), eq(consentVersions.hash, hash)))
    .orderBy(desc(consentVersions.version))
    .all()
    .find((v) => v.text === wording);
  if (known) return known;
  return db.transaction((tx) => {
    const latest = tx
      .select({ version: max(consentVersions.version) })
      .from(consentVersions)
      .where(eq(consentVersions.projectId, project.id))
      .get();
    return tx
      .insert(consentVersions)
      .values({
        id: crypto.randomUUID(),
        projectId: project.id,
        version: (latest?.version ?? 0) + 1,
        text: wording,
        hash,
        createdAt: new Date(),
      })
      .returning()
      .get();
  });
}

/** The project's current wording (its own consent text) as a stored version. */
export function currentConsentVersion(project: Project) {
  return currentConsentVersionFor(project, consentWording(project));
}

export function getConsentVersion(id: string, projectId: string) {
  return (
    getDb()
      .select()
      .from(consentVersions)
      .where(and(eq(consentVersions.id, id), eq(consentVersions.projectId, projectId)))
      .get() ?? null
  );
}

export function listConsentVersions(projectId: string) {
  return getDb()
    .select()
    .from(consentVersions)
    .where(eq(consentVersions.projectId, projectId))
    .orderBy(asc(consentVersions.version))
    .all();
}

export function hashIp(ip: string | null | undefined) {
  if (!env.consentIpHash || !ip || ip === "unknown") return null;
  return crypto.createHmac("sha256", env.sessionSecret).update(`ip:${ip}`).digest("hex").slice(0, 32);
}

export function parseScopes(raw: string | null | undefined): ConsentScope[] {
  try {
    const value = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter((s): s is ConsentScope => CONSENT_SCOPES.includes(s)) : [];
  } catch {
    return [];
  }
}

export function logConsentEvent(input: {
  testimonialId: string;
  type: ConsentEventType;
  actor: Actor;
  version?: { id: string; text: string; hash: string } | null;
  text?: string | null;
  scopes?: ConsentScope[];
  ip?: string | null;
  detail?: string | null;
  at?: Date;
}) {
  const text = input.version?.text ?? input.text ?? null;
  return getDb()
    .insert(consentEvents)
    .values({
      id: crypto.randomUUID(),
      testimonialId: input.testimonialId,
      type: input.type,
      actor: input.actor,
      versionId: input.version?.id ?? null,
      text,
      textHash: input.version?.hash ?? (text ? sha256(text) : null),
      scopes: input.scopes ? JSON.stringify(input.scopes) : null,
      ipHash: hashIp(input.ip),
      detail: input.detail ?? null,
      createdAt: input.at ?? new Date(),
    })
    .returning()
    .get();
}

export function listConsentEvents(testimonialId: string) {
  return getDb()
    .select()
    .from(consentEvents)
    .where(eq(consentEvents.testimonialId, testimonialId))
    .orderBy(asc(consentEvents.createdAt))
    .all();
}

/**
 * Records consent for a new submission and returns the private withdrawal
 * token (only its hash is stored).
 */
export function grantConsent(input: {
  testimonialId: string;
  project: Project;
  versionId?: string | null;
  /** The wording the form showed, when it isn't the project's own (a form's consent page). */
  wording?: string;
  scopes: ConsentScope[];
  /** false when the person chose to keep it private: it can then never be approved (D11). */
  public?: boolean;
  actor: Actor;
  ip?: string | null;
}) {
  // Record the wording the person actually saw, if the form told us which.
  const version =
    (input.versionId && getConsentVersion(input.versionId, input.project.id)) ||
    (input.wording === undefined
      ? currentConsentVersion(input.project)
      : currentConsentVersionFor(input.project, input.wording));
  const scopes = [...new Set<ConsentScope>(["website", ...input.scopes])];
  const token = crypto.randomBytes(24).toString("base64url");
  getDb()
    .update(testimonials)
    .set({
      consentScopes: JSON.stringify(scopes),
      withdrawTokenHash: sha256(token),
      ...(input.public === undefined ? {} : { consentPublic: input.public }),
    })
    .where(eq(testimonials.id, input.testimonialId))
    .run();
  logConsentEvent({
    testimonialId: input.testimonialId,
    type: "granted",
    actor: input.actor,
    version,
    scopes,
    ip: input.ip,
    detail: input.public === false ? "Asked to keep it private: for internal use, never published" : null,
  });
  return token;
}

export function withdrawUrl(token: string) {
  return `${env.publicUrl}/w/${token}`;
}

export function findByWithdrawToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return getDb().select().from(testimonials).where(eq(testimonials.withdrawTokenHash, sha256(token))).get() ?? null;
}

/**
 * Unpublishes the testimonial for good and logs who withdrew it. Idempotent.
 * One in the trash stays there; restoring it brings it back as rejected.
 */
export function withdrawConsent(testimonialId: string, opts: { actor: Actor; ip?: string | null; detail?: string }) {
  const db = getDb();
  const row = db.select().from(testimonials).where(eq(testimonials.id, testimonialId)).get();
  if (!row) return null;
  if (row.withdrawnAt) return row;
  const now = new Date();
  const inTrash = row.status === "trashed";
  db.transaction((tx) => {
    tx.update(testimonials)
      .set({
        withdrawnAt: now,
        ...(inTrash ? { statusBeforeTrash: "rejected" as const } : { status: "rejected" as const }),
        approvedBy: null,
        approvedAt: null,
        approvalRule: null,
        updatedAt: now,
      })
      .where(eq(testimonials.id, testimonialId))
      .run();
    recordHistory(tx, {
      testimonialId,
      actor: opts.actor satisfies HistoryActor,
      action: "status",
      diff: { status: [row.status, inTrash ? row.status : "rejected"], withdrawnAt: [null, now.toISOString()] },
      at: now,
    });
  });
  logConsentEvent({ testimonialId, type: "withdrawn", actor: opts.actor, ip: opts.ip, detail: opts.detail, at: now });
  return db.select().from(testimonials).where(eq(testimonials.id, testimonialId)).get()!;
}

/** Fields the author wrote or agreed to; changing them is logged as an edit. */
export const CONSENTED_FIELDS = ["text", "authorName", "authorTitle", "authorCompany", "rating", "headline", "trimStartMs", "trimEndMs", "videoKey"] as const;
