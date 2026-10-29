# Sales popup and "Verified purchase"

Connect a project to Stripe and Plaudit can show recent purchases in a small popup on your site ("Priya from Leeds bought Pro plan · 2 hours ago"), and mark testimonials from people who bought as **Verified purchase**. Both are part of the **Commerce** tab (feature flag `commerce`, on by default).

## What's kept, and for how long

From each purchase Plaudit keeps only what the popup can show:

- the **first name** (never the surname),
- a **city**, or the **country** when Stripe has no city (never the street, postcode or region),
- the **product**, the **amount** and the **time**.

It never keeps the buyer's email, the rest of their name, the address or any card or payment detail. To match testimonials, it keeps a keyed hash of the email (an HMAC made with a random key your server creates for itself and keeps in its database), which can't be turned back into the address. Changing `SESSION_SECRET` doesn't affect it. Purchases recorded before that key existed were hashed with `SESSION_SECRET` and still match until they expire, as long as it hasn't changed. Purchases are deleted after **90 days** by default; you choose between 1 and 365 days on the Commerce tab, and **Delete all purchases** removes them at once. "Verified purchase" marks on testimonials stay.

## Connect Stripe

You need to be an admin.

1. Open the project and go to **Commerce**. Click **Connect Stripe**. Plaudit shows the project's own **webhook endpoint URL**.
2. In Stripe, go to **Developers › Webhooks › Add endpoint**. Paste the URL and choose the events `checkout.session.completed` and `invoice.paid`. Save it.
3. On the endpoint's page in Stripe, reveal the **Signing secret** (it starts `whsec_`). Paste it into **Signing secret** on the Commerce tab and click **Save**.
4. Make a test purchase (in Stripe's test mode, with a test endpoint and its own secret, if you like). It appears under **Recorded purchases**, and **Last event** says what happened.

Every delivery must be signed with that secret, so nobody else can add purchases. The URL alone isn't enough. The secret is never shown again; paste a new one to replace it.

**The product's name.** Stripe's Checkout events don't include what was bought. Add a `product_name` entry to the metadata of your Payment Link or Checkout Session (Stripe calls it "Metadata"), or set **When Stripe names no product, say they bought** on the Commerce tab. Invoices (subscriptions) use the first line's description, without the quantity and price.

## Make the popup

1. Go to **Widgets**, type a name, choose the layout **Sales popup** and click **Create**.
2. In the studio's **Settings** tab, choose which details visitors see: first name, city or country, what they bought, the amount paid and how long ago. Anything you switch off never leaves your server. You can also **Mix in approved testimonials** (short snippets of the testimonials this widget picks, between the purchases) and limit it to purchases from the last so many days.
3. Set the **corner**, the **delay** before the first one and **how long each stays**, and whether it hides on phones. The brand colour is the **Accent** on the Design tab.
4. The words are on the **Labels** tab: the line ("{name} from {place} bought {product}"), the line without a place, and what to say when the name or product is hidden ("Someone", "from us"). Write them in your site's language.
5. Copy the script snippet from **Share** and paste it into your site, like any widget. Until you do, the popup shows nowhere.

For visitors:

- It's a small card in a corner, one purchase after another, that waits while someone hovers or uses it.
- Screen readers hear each new line once, politely, without being interrupted.
- The close button hides it for that visitor for 30 days (remembered in their browser; in a private window, until they reload).
- Visitors who ask for reduced motion get no sliding or fading.
- It sets no cookies, loads nothing from other sites, and reads a public feed that has only the display fields above (cached for 30 seconds).

## Verified purchase

With **Mark testimonials from buyers as "Verified purchase"** on (the default), a testimonial whose email matches a recorded purchase gets the mark, whether it arrived before or after the purchase. You see it in the inbox drawer, where an editor can remove it with ×. It can only be put back while a matching purchase is on record.

Widgets show "✓ Verified purchase" on those testimonials, in place of the form's "Verified" mark, unless you switch off **"Verified purchase" mark** on the Design tab. Walls have the same switch under **Cards**. The words can be changed on a widget's Labels tab.

## Who can do what

Admins connect and disconnect Stripe, set its secrets and delete purchases, as with webhooks and API keys. Everyone with access to the project can see the Commerce tab and what was recorded. Editors can remove a testimonial's mark.

## Turning it off

Switch **Record purchases** off to stop keeping anything (Stripe's events are still answered, so it doesn't retry them). **Disconnect** deletes the connection and every recorded purchase; its webhook URL stops working, so remove the endpoint in Stripe too. With `commerce` left out of `PLAUDIT_FEATURES`, the Commerce tab is hidden, the webhook answers 404 and popups show nothing.

## Moving the project

A project export carries the connection's settings and the recorded purchases (never an email), but not the signing secret or the restricted key. After importing, the Commerce tab says so: paste both again, and point Stripe's webhook at the new address shown there. On the same server, purchases still match testimonials. On another server they can't (its key is different), so they're kept for the popup only; "Verified purchase" marks already on testimonials come across.

## If something's wrong

- **"Refused a delivery with a wrong signature"**: the signing secret doesn't match the endpoint. Copy it again from that endpoint in Stripe (test and live endpoints have different secrets).
- **Nothing in the popup**: check that the connection is **On**, that the purchases are newer than the popup's "last … days", and that the widget's script is on the page. Purchases are cached for up to a minute.
- **"bought from us"**: Stripe sent no product name; see "The product's name" above.
