# Notifications

_On by default (the `notifications` section; `PLAUDIT_FEATURES` can turn it off)._

Open **Settings → Notifications**. Nothing is sent until someone turns it on.

## Your emails

Each person on the team sets their own, and they go to the address you sign in with. Email has to be set up on the server first ([EMAIL.md](../EMAIL.md)).

- **New testimonials**: an email for each one as it arrives, one email a day (a digest of what came in over the last day), or none.
- **Weekly reminder**: on Mondays, how many testimonials are waiting for review in each project.
- **Import summary**: when an import from a review site or another tool finishes.
- **Monthly report**: on the 1st, last month's numbers for each project: received, approved, with video, and the average rating.
- **Projects**: all of them, or only the ones you tick.

Digests, the reminder and the report go out at `DIGEST_HOUR_UTC` (8:00 UTC unless the server says otherwise), once each, even if the server restarts. Emails only go to people who have signed in at least once and can still sign in: someone removed from the team stops getting them straight away.

Testimonials you add by hand and ones brought in by an import never send "new testimonial" emails or chat messages.

## Chat channels

Post new testimonials to a team chat. Each message has the stars, the quote, who wrote it and a **Review and approve** link that opens it in the inbox.

| Service | What to paste |
|---|---|
| Slack | An Incoming Webhook URL (`https://hooks.slack.com/services/…`): add the Incoming Webhooks app to a channel |
| Discord | A channel webhook URL (`https://discord.com/api/webhooks/…`): channel settings → Integrations → Webhooks |
| Microsoft Teams | A Workflows URL from “Post to a channel when a webhook request is received” (`https://….logic.azure.com/…` or `….powerplatform.com`), or an older connector URL (`….webhook.office.com`) |
| Telegram | A bot token from @BotFather and the chat id (a number, or `@yourchannel`); add the bot to the group or channel first |

- **Project**: one project, or all of them.
- **Post about**: new testimonials, approved ones, or both.
- **Send test** posts a sample message and shows the service's answer if it fails. **Pause** stops a channel without deleting it.
- Saved URLs and tokens are never shown again in full.
- Plaudit only posts to each service's own addresses, over https.

### Per form

In a form's **Settings → Chat notifications**, choose **Every channel for this project** (the default) or only the channels you tick. Ticking none keeps that form out of chat.

## Webhooks

Webhooks for your own tools (n8n, Zapier, Make) are under **Settings → Webhooks**, and **Edit** changes a webhook's URL, events, project and form. See [API.md](../API.md#webhooks).
