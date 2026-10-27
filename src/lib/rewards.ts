import crypto from "node:crypto";
import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/db";
import type { Form, TestimonialRequest } from "@/db/schema";
import { parseCsv } from "./csv";
import { parseReward, pickPrize, type GrantedReward, type WheelPrize } from "./rewards-config";

export * from "./rewards-config";

const { rewardCodes, campaigns, testimonials, feedback, requests } = schema;

/**
 * Rewards (FORM-13) and per-recipient codes (REQ-08), on the server.
 *
 * Compliance, enforced here and by a test that reads this file: the decision
 * takes the form's reward settings, whether there's a video and whether the
 * person was sent to private feedback, and nothing else. It never sees the
 * stars, the words or the consent choice, so a reward can't depend on a
 * review being positive (FTC rules, Google's and Trustpilot's policies). A
 * submission the low-rating branch turned into private feedback gets the
 * same reward as everyone else.
 *
 * Unique codes come from the form's pool (reward_codes). Claiming is one
 * UPDATE that picks the oldest free code and checks it's still free, so two
 * submissions can never get the same code, and the unique indexes allow at
 * most one code per submission and per campaign recipient.
 */

type Conn = Pick<Tx, "get" | "select" | "update" | "insert" | "delete">;

/** Per upload, and per pool. */
export const MAX_CODES_PER_UPLOAD = 10_000;
export const MAX_POOL_SIZE = 50_000;
const CODE_RE = /^[^\s\p{Cc}](?:[^\p{Cc}]{0,98}[^\s\p{Cc}])?$/u;

export type RewardTarget = { testimonialId?: string | null; feedbackId?: string | null };

// ------------------------------------------------------------------ the decision

export type GrantInput = {
  form: Pick<Form, "id" | "reward">;
  /** The submission has a video (main or any other answer), for "only for video". */
  hasVideo: boolean;
  /** Sent to private feedback by the low-rating branch: always eligible, as they couldn't record a video. */
  privateFeedback: boolean;
  /** The personal request link it came through, if any (a campaign may attach codes, REQ-08). */
  request: Pick<TestimonialRequest, "id" | "campaignId"> | null;
  /** The stored submission the reward belongs to. */
  target: RewardTarget;
};

/** A uniform number in [0, 1) from the system's secure random source: the spin is decided here, never by the browser. */
const secureRandom = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

/** One spin of the wheel: the index of the prize it lands on, by weight. */
export function spinWheel(prizes: Pick<WheelPrize, "weight">[], random: () => number = secureRandom): number {
  return pickPrize(
    prizes.map((p) => p.weight),
    random(),
  );
}

/**
 * What this submission is given, once (the caller runs it once, inside the
 * submission's transaction). null when the form has no reward or the
 * submission doesn't qualify; `sold_out` when the code pool is empty.
 */
export function grantReward(conn: Conn, i: GrantInput): GrantedReward | null {
  const cfg = parseReward(i.form.reward);
  const words = { title: cfg.title.trim(), message: cfg.message.trim() };
  const soldOut: GrantedReward = { status: "sold_out", ...words };
  const campaign = i.request?.campaignId
    ? conn.select({ rewardCodes: campaigns.rewardCodes }).from(campaigns).where(eq(campaigns.id, i.request.campaignId)).get()
    : undefined;
  // A campaign that attaches codes: every recipient who responds gets their own (the one in their email, if it had one).
  if (campaign?.rewardCodes && i.request) {
    const code = codeForRequest(conn, i.form.id, i.request.id, i.target);
    return code ? { status: "given", ...words, code, url: null } : soldOut;
  }
  if (cfg.mode === "none") return null;
  if (cfg.onlyVideo && !i.hasVideo && !i.privateFeedback) return null;
  if (cfg.mode === "wheel") {
    const won = spinWheel(cfg.prizes);
    const prize = cfg.prizes[won];
    return {
      status: "given",
      ...words,
      code: prize.code || null,
      url: null,
      wheel: { labels: cfg.prizes.map((p) => p.label), chances: cfg.prizes.map((p) => p.weight), won },
    };
  }
  if (cfg.kind === "url") return { status: "given", ...words, code: null, url: cfg.url };
  if (cfg.kind === "code") return { status: "given", ...words, code: cfg.code, url: null };
  const code = claimCode(conn, i.form.id, i.target);
  return code ? { status: "given", ...words, code, url: null } : soldOut;
}

// ------------------------------------------------------------------ claiming

/** Claims the pool's oldest free code for `who`, or null when none is left. Atomic: one statement. */
export function claimCode(conn: Conn, formId: string, who: RewardTarget & { requestId?: string | null }): string | null {
  const row = conn.get<{ code: string } | undefined>(sql`
    UPDATE reward_codes
       SET claimed_at = ${Date.now()},
           testimonial_id = ${who.testimonialId ?? null},
           feedback_id = ${who.feedbackId ?? null},
           request_id = ${who.requestId ?? null}
     WHERE id = (SELECT id FROM reward_codes WHERE form_id = ${formId} AND claimed_at IS NULL ORDER BY created_at, id LIMIT 1)
       AND claimed_at IS NULL
    RETURNING code`);
  return row?.code ?? null;
}

/**
 * A campaign recipient's own code (REQ-08): the one already reserved for
 * them (by their invitation email), else a new one from the pool. Linking it
 * to the submission happens here too.
 */
export function codeForRequest(conn: Conn, formId: string, requestId: string, target: RewardTarget = {}): string | null {
  const existing = conn.select().from(rewardCodes).where(eq(rewardCodes.requestId, requestId)).get();
  if (existing) {
    const link = {
      ...(target.testimonialId && !existing.testimonialId ? { testimonialId: target.testimonialId } : {}),
      ...(target.feedbackId && !existing.feedbackId ? { feedbackId: target.feedbackId } : {}),
    };
    if (Object.keys(link).length) conn.update(rewardCodes).set(link).where(eq(rewardCodes.id, existing.id)).run();
    return existing.code;
  }
  return claimCode(conn, formId, { ...target, requestId });
}

/** For the invitation email's {{reward_code}}: reserves the recipient's code now (idempotent). */
export function reserveCodeForRequest(formId: string, requestId: string): string | null {
  return getDb().transaction((tx) => codeForRequest(tx, formId, requestId));
}

/**
 * Undoes a claim when the submission it was for couldn't be stored. A code
 * reserved for a campaign recipient stays theirs.
 */
export function releaseCodes(conn: Conn, target: RewardTarget) {
  for (const [column, id] of [
    [rewardCodes.testimonialId, target.testimonialId],
    [rewardCodes.feedbackId, target.feedbackId],
  ] as const) {
    if (!id) continue;
    conn.update(rewardCodes).set({ claimedAt: null }).where(and(eq(column, id), isNull(rewardCodes.requestId))).run();
    conn.update(rewardCodes).set({ testimonialId: null, feedbackId: null }).where(eq(column, id)).run();
  }
}

// ------------------------------------------------------------------ the pool (owner side)

/** One code per line, or the first column of a CSV; a "code" header row is skipped. */
export function parseCodes(text: string): { codes: string[]; invalid: { line: number; text: string }[] } {
  const codes: string[] = [];
  const invalid: { line: number; text: string }[] = [];
  parseCsv(text).forEach((row, i) => {
    const cell = (row.find((c) => c.trim()) ?? "").trim();
    if (!cell) return;
    if (i === 0 && /^(codes?|coupons?|coupon codes?|reward codes?)$/i.test(cell)) return;
    if (CODE_RE.test(cell)) codes.push(cell);
    else invalid.push({ line: i + 1, text: cell.slice(0, 120) });
  });
  return { codes, invalid };
}

export type PoolStats = { total: number; claimed: number; left: number };

export function poolStats(formId: string): PoolStats {
  const db = getDb();
  const total = db.select({ n: count() }).from(rewardCodes).where(eq(rewardCodes.formId, formId)).get()?.n ?? 0;
  const claimed = db.select({ n: count() }).from(rewardCodes).where(and(eq(rewardCodes.formId, formId), isNotNull(rewardCodes.claimedAt))).get()?.n ?? 0;
  return { total, claimed, left: total - claimed };
}

/** Adds codes to the form's pool. Codes already in it are skipped (and counted). */
export function addCodes(form: Pick<Form, "id" | "projectId">, text: string) {
  const { codes, invalid } = parseCodes(text);
  const unique = [...new Set(codes)];
  if (unique.length > MAX_CODES_PER_UPLOAD) throw new RewardError(400, `Up to ${MAX_CODES_PER_UPLOAD.toLocaleString("en")} codes at a time`);
  const { total } = poolStats(form.id);
  if (total + unique.length > MAX_POOL_SIZE) throw new RewardError(400, `A pool holds up to ${MAX_POOL_SIZE.toLocaleString("en")} codes`);
  const now = Date.now();
  const added = getDb().transaction((tx) => {
    let n = 0;
    unique.forEach((code, i) => {
      n += tx
        .insert(rewardCodes)
        // Codes keep their order in the file: the oldest free one is handed out first.
        .values({ id: crypto.randomUUID(), projectId: form.projectId, formId: form.id, code, createdAt: new Date(now + i) })
        .onConflictDoNothing()
        .run().changes;
    });
    return n;
  });
  return { added, duplicates: codes.length - added, invalid: invalid.length, invalidLines: invalid.slice(0, 5), stats: poolStats(form.id) };
}

/** Deletes the codes nobody has claimed yet; claimed ones stay for the record. */
export function removeUnclaimed(formId: string) {
  const removed = getDb().delete(rewardCodes).where(and(eq(rewardCodes.formId, formId), isNull(rewardCodes.claimedAt))).run().changes;
  return { removed, stats: poolStats(formId) };
}

export type Claim = { code: string; claimedAt: string; who: string | null; via: "testimonial" | "feedback" | "recipient" | "removed" };

/** Claim tracking: the latest claimed codes and who got each one. */
export function listClaims(formId: string, limit = 50): Claim[] {
  const rows = getDb()
    .select({
      code: rewardCodes.code,
      claimedAt: rewardCodes.claimedAt,
      testimonialId: rewardCodes.testimonialId,
      feedbackId: rewardCodes.feedbackId,
      requestId: rewardCodes.requestId,
      tName: testimonials.authorName,
      tEmail: testimonials.authorEmail,
      fName: feedback.authorName,
      fEmail: feedback.authorEmail,
      rName: requests.name,
      rEmail: requests.email,
    })
    .from(rewardCodes)
    .leftJoin(testimonials, eq(testimonials.id, rewardCodes.testimonialId))
    .leftJoin(feedback, eq(feedback.id, rewardCodes.feedbackId))
    .leftJoin(requests, eq(requests.id, rewardCodes.requestId))
    .where(and(eq(rewardCodes.formId, formId), isNotNull(rewardCodes.claimedAt)))
    .orderBy(desc(rewardCodes.claimedAt))
    .limit(limit)
    .all();
  return rows.map((r) => {
    const via: Claim["via"] = r.testimonialId ? "testimonial" : r.feedbackId ? "feedback" : r.requestId ? "recipient" : "removed";
    const who = r.tName || r.tEmail || r.fName || r.fEmail || r.rName || r.rEmail || null;
    return { code: r.code, claimedAt: r.claimedAt!.toISOString(), who, via };
  });
}

export class RewardError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The reward as plain text, for the confirmation email. */
export function rewardText(reward: GrantedReward, projectName: string): string {
  const title = reward.title || `A thank-you from ${projectName}`;
  if (reward.status === "sold_out") return `${title}\nAll the rewards have been claimed, but thank you all the same.`;
  const won = reward.wheel ? `You won: ${reward.wheel.labels[reward.wheel.won]}` : "";
  return [title, reward.message, won, reward.code ? `Your code: ${reward.code}` : "", reward.url ?? ""].filter(Boolean).join("\n");
}
