import crypto from "node:crypto";
import { getDb, schema } from "@/db";
import type { Form, Project } from "@/db/schema";
import { audit, SYSTEM } from "../audit";
import { featureOn } from "../features";
import type { GrantedReward, RewardTarget } from "../rewards";
import { createPromotionCode, StripeApiError } from "./stripe-api";
import { getConnection, noteConnectionResult } from "./stripe-connection";

const { rewardCodes } = schema;

/**
 * INT-07 thank-you coupons: the second half of a "Stripe coupon" reward.
 * grantReward (rewards.ts) decides who gets one, by the same rules as every
 * other reward (never by what anyone said or how they rated); this makes the
 * person's single-use promotion code at Stripe once the submission is stored,
 * and records it with the form's other claimed codes. When Stripe fails the
 * person still gets the thank-you, without a code, and the reason goes to the
 * audit log for the owner. Every call to Stripe is audit-logged.
 */
export async function finishReward(
  project: Pick<Project, "id">,
  form: Pick<Form, "id">,
  reward: GrantedReward | null,
  target: RewardTarget,
): Promise<GrantedReward | null> {
  if (!reward || reward.status !== "given" || !reward.stripe) return reward;
  const { stripe, ...given } = reward;
  const unavailable: GrantedReward = { status: "unavailable", title: given.title, message: given.message };
  const forWhom = target.testimonialId ?? target.feedbackId ?? crypto.randomUUID();
  const meta = { formId: form.id, coupon: stripe.coupon, ...(target.testimonialId ? { testimonialId: target.testimonialId } : {}), ...(target.feedbackId ? { feedbackId: target.feedbackId } : {}) };
  const c = featureOn("commerce") ? getConnection(project.id) : null;
  const fail = (why: string) => {
    audit(SYSTEM, "stripe.promotion_code_failed", { objectType: "form", objectId: form.id, projectId: project.id, summary: `Couldn't make a thank-you code: ${why}`, meta });
    // Also on the Commerce page, for servers without the audit log (team2 off).
    if (c) noteConnectionResult(c.id, `Couldn't make a thank-you code: ${why}`);
    return unavailable;
  };
  if (!c?.restrictedKey) return fail("this project's Stripe connection has no restricted key");
  try {
    const promo = await createPromotionCode({
      restrictedKey: c.restrictedKey,
      coupon: stripe.coupon,
      idempotencyKey: `plaudit-reward-${forWhom}`,
      expiresAt: stripe.expiresDays ? new Date(Date.now() + stripe.expiresDays * 86_400_000) : null,
      metadata: { plaudit_form: form.id, ...(target.testimonialId ? { plaudit_testimonial: target.testimonialId } : {}), ...(target.feedbackId ? { plaudit_feedback: target.feedbackId } : {}) },
    });
    audit(SYSTEM, "stripe.promotion_code", { objectType: "form", objectId: form.id, projectId: project.id, summary: "Made a single-use thank-you code at Stripe", meta: { ...meta, promotionCodeId: promo.id } });
    // Listed with the form's claimed codes, so the owner sees who got which.
    getDb()
      .insert(rewardCodes)
      .values({
        id: crypto.randomUUID(),
        projectId: project.id,
        formId: form.id,
        code: promo.code,
        claimedAt: new Date(),
        testimonialId: target.testimonialId ?? null,
        feedbackId: target.feedbackId ?? null,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .run();
    return { ...given, code: promo.code };
  } catch (err) {
    if (err instanceof StripeApiError) return fail(err.message);
    console.error("[coupons] couldn't make a promotion code:", err);
    return fail("an unexpected error");
  }
}
