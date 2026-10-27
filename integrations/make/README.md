# Plaudit scenario for Make

## Invites after a purchase (`plaudit-invite-after-purchase.blueprint.json`)

A custom webhook (your shop's "order paid") → **HTTP › Make a request** to `POST /api/v1/invites`, so Plaudit emails the campaign's invitation 7 days later.

1. In Make, create a scenario, open the **…** menu and **Import Blueprint**, and choose the file.
2. On the webhook module, add a webhook and copy its address into your shop's webhook settings. Send one test order so Make learns the fields (`email`, `name`).
3. On the HTTP module, set the URL to your server, replace `plk_REPLACE_ME` with a read-and-write API key and `REPLACE_WITH_CAMPAIGN_ID` with the id from the campaign's **Auto-collect** tab (the campaign must be started).

The scenario is marked confidential, so the key doesn't show in its run history.

## Receiving Plaudit's webhooks in Make

Add a **Webhooks › Custom webhook** module and add its address in Plaudit under **Settings › Webhooks**. To check the signature, turn on the webhook's **JSON pass-through** and **Get request headers** options, so the raw body arrives as `value`, then add a filter that compares the `v1` part of the `plaudit-signature` header with `sha256(t + "." + value; "hex"; secret)`, where `t` is the header's timestamp part ([how the signature works](../../docs/API.md#verifying-webhook-signatures)).

This blueprint follows Make's export format but hasn't been imported into a live Make account as part of Plaudit's tests.
