import { z } from "zod";

/**
 * A form's reward (FORM-13), stored as JSON in forms.reward. Client-safe, so
 * the builder checks it the same way the server does.
 *
 * Compliance (FTC endorsement rules, Google's and Trustpilot's review
 * policies): a reward never depends on what someone says or how they rate.
 * Nothing in this config can look at the answers; the only condition is
 * "only for video", which is about the format, never the sentiment.
 */

if (typeof window !== "undefined") z.config({ jitless: true });

export const REWARD_MODES = ["none", "same", "wheel"] as const;
export type RewardMode = (typeof REWARD_MODES)[number];
/**
 * What "the same for everyone" hands out: one coupon code, a link, a unique
 * code from the form's pool, or (INT-07, flag `commerce`) a single-use Stripe
 * promotion code made from the owner's coupon when the reward is given.
 */
export const REWARD_KINDS = ["code", "url", "pool", "stripe"] as const;
export type RewardKind = (typeof REWARD_KINDS)[number];

export const MAX_PRIZES = 12;
const httpUrl = z.url({ protocol: /^https?$/, error: "Enter a full link starting with https://" }).max(2000);

export const wheelPrizeSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{1,16}$/),
  label: z.string().trim().min(1, "Give each prize a label").max(60),
  /** Empty for a prize without a code ("Free coffee next visit"). */
  code: z.string().trim().max(100).default(""),
  /** Percent; all the prizes add up to 100. */
  weight: z.number().min(0, "Chances can't be negative").max(100),
});
export type WheelPrize = z.infer<typeof wheelPrizeSchema>;

const rewardObject = z.object({
  mode: z.enum(REWARD_MODES).default("none"),
  /** Only submissions with a video get it (people sent to private feedback always do: they can't record one). */
  onlyVideo: z.boolean().default(false),
  /** Shown above the reward; empty = "A thank-you from {project}". */
  title: z.string().max(120).default(""),
  message: z.string().max(500).default(""),
  kind: z.enum(REWARD_KINDS).default("code"),
  code: z.string().trim().max(100).default(""),
  url: z.union([z.literal(""), httpUrl]).default(""),
  /** INT-07: the Stripe coupon's ID; each person gets their own promotion code for it. */
  stripeCoupon: z
    .string()
    .trim()
    .max(100)
    .regex(/^[A-Za-z0-9_-]*$/, "Use the coupon's ID from Stripe (letters, numbers, - and _)")
    .default(""),
  /** Days each promotion code works for; 0 = until the coupon itself ends. */
  stripeExpiresDays: z.number().int("Whole days").min(0).max(365).default(0),
  prizes: z.array(wheelPrizeSchema).max(MAX_PRIZES, `Up to ${MAX_PRIZES} prizes`).default([]),
});

export const rewardConfigSchema = rewardObject.superRefine((r, ctx) => {
  const issue = (message: string, path: string[]) => ctx.addIssue({ code: "custom", message, path });
  if (r.mode === "same") {
    if (r.kind === "code" && !r.code) issue("Enter the coupon code everyone gets", ["code"]);
    if (r.kind === "url" && !r.url) issue("Enter the reward's link", ["url"]);
    if (r.kind === "stripe" && !r.stripeCoupon) issue("Enter the ID of the Stripe coupon to make codes from", ["stripeCoupon"]);
  }
  if (r.mode === "wheel") {
    if (r.prizes.length < 2) issue("A wheel needs at least two prizes", ["prizes"]);
    const total = wheelTotal(r.prizes);
    if (r.prizes.length >= 2 && Math.abs(total - 100) > 0.01) issue(`The prizes' chances must add up to 100% (now ${round(total)}%)`, ["prizes"]);
    const ids = r.prizes.map((p) => p.id);
    if (new Set(ids).size !== ids.length) issue("Two prizes share an id", ["prizes"]);
  }
});
export type RewardConfig = z.infer<typeof rewardConfigSchema>;

const round = (n: number) => Math.round(n * 100) / 100;
export const wheelTotal = (prizes: Pick<WheelPrize, "weight">[]) => prizes.reduce((sum, p) => sum + p.weight, 0);

export const defaultReward = (): RewardConfig => rewardObject.parse({});

/** forms.reward as a config; anything unreadable is "no reward", so a bad row never hands out something odd. */
export function parseReward(raw: string | null | undefined): RewardConfig {
  try {
    const parsed = rewardConfigSchema.safeParse(JSON.parse(raw || "{}"));
    return parsed.success ? parsed.data : defaultReward();
  } catch {
    return defaultReward();
  }
}

export const rewardOn = (r: Pick<RewardConfig, "mode">) => r.mode !== "none";

/**
 * Which prize a uniform random number in [0, 1) lands on: each prize gets a
 * slice of the line as wide as its weight. Pure, so the odds are testable.
 */
export function pickPrize(weights: number[], random: number): number {
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (!(total > 0)) return 0;
  let at = Math.min(Math.max(random, 0), 0.999999999) * total;
  for (let i = 0; i < weights.length; i++) {
    const w = Math.max(0, weights[i]);
    if (at < w) return i;
    at -= w;
  }
  // Rounding left a sliver past the end: the last prize with any chance.
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i;
  return 0;
}

/**
 * What a person is given after sending (the thank-you page and the
 * confirmation email). A wheel lists every prize's label and chance (never
 * the other prizes' codes) and which one it landed on. `unavailable` is a
 * Stripe coupon that Stripe couldn't make (the owner sees why in the audit
 * log); the thank-you still shows.
 */
export type GrantedReward =
  | {
      status: "given";
      title: string;
      message: string;
      code: string | null;
      url: string | null;
      wheel?: { labels: string[]; chances: number[]; won: number };
      /**
       * Server-only, never sent: a Stripe promotion code is still to be made
       * from this coupon (src/lib/commerce/coupons.ts finishReward removes it).
       */
      stripe?: { coupon: string; expiresDays: number };
    }
  | { status: "sold_out"; title: string; message: string }
  | { status: "unavailable"; title: string; message: string };
