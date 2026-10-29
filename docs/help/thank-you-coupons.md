# Thank-you coupons from Stripe

Give everyone who sends a form their own single-use Stripe promotion code, made from a coupon you already have in Stripe. It's one of a form's **rewards** ([forms.md](forms.md)), with the `commerce` feature flag (on by default).

Like every reward, it thanks people for their time: **everyone who sends the form gets it, whatever they rate or say**, including people sent to private feedback by a low rating. Rules such as the FTC's and the review sites' own forbid rewards that depend on a review being positive, and Plaudit never looks at the rating or the words to decide.

## What you need

- The project connected to Stripe on its **Commerce** tab ([sales-popup.md](sales-popup.md#connect-stripe)). Only the connection's restricted key is used here; the webhook isn't needed for coupons.
- A **coupon** in Stripe (**Product catalog › Coupons**), for example 10% off once. Note its **ID**.
- A **restricted key** with one permission.

## Make the restricted key

A restricted key can do only what you allow, so a leaked key can't read your customers or move money.

1. In Stripe, go to **Developers › API keys › Create restricted key**.
2. Name it "Plaudit thank-you codes".
3. Set **Promotion codes** to **Write**. Leave every other permission at **None**.
4. Create it, copy the key (it starts `rk_live_` or `rk_test_`) and paste it into **Restricted key** on the project's Commerce tab. Click **Save**.

Never paste your secret key (`sk_…`); Plaudit refuses it. The key is stored on your server, used only to make promotion codes and never shown again (only its last four characters, so you can tell which it is).

## Set up the reward

1. Open the form, then **Settings › Rewards**.
2. **Give people who send the form**: *The same for everyone*. **What they get**: *A single-use Stripe promotion code each (from your coupon)*.
3. Enter the **Coupon ID**. Optionally, **Each code works for** a number of days (0 keeps each code until the coupon itself ends).
4. Add a title and message if you like, and save the form.

Rewards show on the step-by-step form's thank-you page, so the classic page doesn't give them.

## What happens

When someone sends the form, Plaudit stores their testimonial first, then asks Stripe for a new promotion code for your coupon, usable once (and expiring when you said). The code appears on their thank-you page with a Copy button and in their confirmation email, and it's listed with the form's **Claimed codes**, next to who got it. Each code carries the testimonial's id in its Stripe metadata.

Plaudit retries safely: a repeated request for the same submission gets the same code back from Stripe, not a second one.

## When Stripe can't make the code

If Stripe refuses (a coupon that no longer exists, a key without the permission, Stripe unreachable for 10 seconds), the person still sees the thank-you, with a note that their code couldn't be made and that the team has been told. The reason goes to the **audit log** (Settings › Audit log, action `stripe.promotion_code_failed`) and to **Last event** on the Commerce tab. You can then send them a code yourself.

Every request to Stripe, successful or not, is in the audit log (`stripe.promotion_code`), without the key.

## Testing

Use Stripe's test mode: a test coupon and a `rk_test_` key. Codes made with a test key work only in test mode.

Self-hosters testing without Stripe can point `STRIPE_API_URL` at a stand-in that answers `POST /v1/promotion_codes` with `{"id": "…", "code": "…"}`; Plaudit's own tests do this.
