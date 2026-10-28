# Plaudit workflows for n8n

Import a file with **Workflows › Import from file** in n8n, then fill in the placeholders.

## Approved testimonials to Slack (`plaudit-approved-to-slack.json`)

Plaudit's signed webhook → check the signature → post the quote to Slack.

1. Open the **Plaudit webhook** node and copy its production URL. Its **Raw Body** option is on, which the signature check needs.
2. In Plaudit, **Settings › Webhooks**, add that URL with the `testimonial.approved` event, then **Reveal** the secret.
3. In the **Verify signature** node, replace `whsec_REPLACE_ME` with the secret. Your n8n server needs `NODE_FUNCTION_ALLOW_BUILTIN=crypto` for the check. A delivery with a wrong signature or a timestamp more than 5 minutes off stops the run with an error.
4. Choose your Slack credential and channel in **Post to Slack**, activate the workflow, and press **Send test event** in Plaudit (a `ping`, which the workflow ignores).

## Invites after a purchase (`plaudit-invite-after-purchase.json`)

Your shop or CRM's webhook → `POST /api/v1/invites` → Plaudit emails the campaign's invitation 7 days later.

1. In Plaudit, create a campaign and **Start** it; copy its id from the **Auto-collect** tab.
2. In **Invite through Plaudit**, set the URL to your server, replace `REPLACE_WITH_CAMPAIGN_ID`, and create a **Header Auth** credential named `Authorization` with the value `Bearer plk_…` (a read-and-write key).
3. Point your shop's "order paid" webhook at the **Order paid** node's URL. The body needs `email` (and optionally `name`); change the expression if your shop names them differently.

Someone already invited, unsubscribed, or who already sent a testimonial gets no second email: Plaudit answers `200` with `skipped`.

These files follow n8n's export format (Webhook v2, Code v2, Slack v2.2, HTTP Request v4.2) but haven't been imported into a live n8n as part of Plaudit's tests.
