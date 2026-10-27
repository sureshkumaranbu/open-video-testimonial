# REST API and webhooks

Plaudit has a small REST API and signed webhooks, so you can connect it to n8n, Zapier, Make, Activepieces or your own scripts. Both are free and have no plan limits.

- [REST API](#rest-api)
- [Webhooks](#webhooks)
- [Verifying webhook signatures](#verifying-webhook-signatures)
- [Connecting n8n](#connecting-n8n)
- [Public widget feed](#public-widget-feed)
- [Walls and review snippets](#walls-and-review-snippets)

The machine-readable description is served by your instance at **`/api/v1/openapi.json`** (OpenAPI 3.1). You can import it into Postman, Insomnia or an API client generator.

## REST API

### Keys

1. Sign in to the dashboard and open **Settings**.
2. Under **API keys**, name the key and choose **Read only** or **Read and write**.
3. Copy the key. It starts with `plk_` and is shown **once**; Plaudit stores only a hash of it.

Send it as a bearer token:

```bash
curl -H "Authorization: Bearer plk_…" https://plaudit.example.com/api/v1/projects
```

Keys can be revoked at any time from the same screen. Each key may make 600 requests a minute. The API is meant for servers and scripts, so it doesn't send CORS headers for browsers.

### Endpoints

All paths are relative to `https://<your-plaudit>/api/v1`.

| Method and path | Scope | What it does |
|---|---|---|
| `GET /projects` | read | Lists projects with their counts per status (`pending`, `approved`, `rejected`, `hidden` and `trashed`) |
| `GET /projects/{slug}/testimonials` | read | Lists testimonials, newest first. Query: `status` (`pending`, `approved`, `rejected`, `hidden`, `trashed` or `withdrawn`), `tag`, `limit` (1 to 100, default 50; anything else is a `400`), `offset`. Testimonials in the trash are left out unless you ask for `status=trashed` |
| `POST /projects/{slug}/testimonials` | write | Adds a text testimonial (see below) |
| `GET /testimonials/{id}` | read | Gets one testimonial |
| `PATCH /testimonials/{id}` | write | Changes `status` (`pending`, `approved`, `rejected` or `hidden`), `tags`, `authorName`, `authorTitle`, `authorCompany`, `text`, `rating`, `transcript` or `captionsVtt`, and the fields listed [below](#editing-a-testimonial) |
| `DELETE /testimonials/{id}` | write | Deletes a testimonial and its media for good. It doesn't go to the trash |
| `POST /invites` | write | Adds a person to an active campaign and queues its invitation, optionally some days later ([below](#campaign-invites)) |

Errors look like `{ "error": "…" }`, with status `400` (invalid input), `401` (missing or invalid key), `403` (read-only key), `404`, `409` (for example, re-publishing a testimonial whose author withdrew consent, or approving one whose author asked to keep it private) or `429`.

Paths use the project's current slug. When you [change a project's link](../README.md#turning-sections-off), its pages and widget keep answering the old one, but the API doesn't: use the new slug.

### A testimonial

```json
{
  "id": "5b0d…",
  "projectId": "9e1f…",
  "formId": "c4a2…",
  "status": "approved",
  "rating": 5,
  "headline": "Six videos in a weekend",
  "text": "We set it up on Friday and had six videos by Monday.",
  "transcript": "Hi, I'm Ada…",
  "primaryQuestion": "What changed after you started using Acme?",
  "answers": [{ "key": "q2", "title": "What would you tell a friend?", "text": "Just try it." }],
  "images": [{ "url": "https://plaudit.example.com/api/media/images/….png", "alt": "Our dashboard" }],
  "author": {
    "name": "Ada Lovelace", "email": "ada@example.com", "phone": null, "title": "CTO", "company": "Engines Ltd",
    "website": "https://engines.example", "socials": { "linkedin": "https://www.linkedin.com/in/ada" },
    "avatarUrl": null, "companyLogoUrl": null
  },
  "video": {
    "url": "https://plaudit.example.com/api/media/videos/….mp4",
    "mime": "video/mp4",
    "originalUrl": "https://plaudit.example.com/api/media/videos/….webm",
    "posterUrl": "https://plaudit.example.com/api/media/images/….jpg",
    "captionsUrl": "https://plaudit.example.com/api/captions/5b0d…",
    "durationMs": 41230, "width": 720, "height": 1280,
    "processing": "ready"
  },
  "tags": ["homepage"],
  "source": "form",
  "platform": null,
  "sourceUrl": null,
  "sourceDate": null,
  "datePrecision": "day",
  "language": "en",
  "customFields": { "plan": "Enterprise" },
  "hiddenFields": { "utm_source": "newsletter" },
  "featured": false,
  "pinOrder": null,
  "requested": true,
  "approvedBy": "owner",
  "approvedAt": "2026-10-22T10:02:11.000Z",
  "consent": { "at": "2026-10-22T09:30:00.000Z", "scopes": ["website", "social"], "public": true, "editedAfterConsent": false, "withdrawnAt": null },
  "trashedAt": null,
  "createdAt": "2026-10-22T09:30:00.000Z",
  "updatedAt": "2026-10-22T10:02:11.000Z"
}
```

Unlike the public widget feed, API responses include **private fields** (the author's email and phone, the consent details, and the custom and hidden fields), because they go to your own systems. Treat API keys like passwords.

`approvedBy` says who approved it, while it's approved: `owner` (someone in the dashboard), `api` (an API key) or `auto` (the project's [auto-approve rule](../README.md#auto-approve)). It's `null` for testimonials that aren't approved, and for ones approved before Plaudit recorded this. `approvedAt` is when.

Each project in `GET /projects` includes its auto-approve settings: `"autoApprove": { "enabled": false, "minRating": 4, "includeVideo": false }`.

`status` is one of:

- `pending`, `approved` or `rejected`.
- **`hidden`**: kept for your own use, and never shown on your site. A testimonial whose author asked to keep it private (`consent.public` is `false`) can be hidden but not approved.
- **`trashed`**: in the dashboard's trash, off your site, and deleted for good `TRASH_RETENTION_DAYS` (30 by default) after `trashedAt`. Restoring puts it back with the status it had (or `rejected`, if the author withdrew consent). The API can't trash or restore; `DELETE` deletes at once.
- **`withdrawn`** once the author withdrew consent through their private link. A withdrawn testimonial can't be published again, and `consent.withdrawnAt` says when it happened. Filtering with `status=rejected` leaves withdrawn ones out.

The other fields:

| Field | What it is |
|---|---|
| `formId` | The form it was sent through. `null` for ones added through the API, by hand or by an import |
| `headline` | A short title above the text |
| `primaryQuestion` | The question the text or video answers, as it was asked |
| `answers` | Answers to the form's further questions, in order. Their videos stay private to you |
| `images` | Photos attached to the testimonial |
| `author.phone`, `author.website`, `author.socials`, `author.companyLogoUrl` | More about the author. `socials` has any of `x`, `linkedin`, `instagram` and `tiktok` |
| `platform`, `sourceUrl`, `sourceDate`, `datePrecision` | Where a review was first posted (such as `google`), its link and date there. `datePrecision` is `day`, `month` or `year`: an import that only knows "Oct 2026" says `month` |
| `language` | A language code such as `en` or `pt-BR` |
| `customFields`, `hiddenFields` | Answers to the form's custom fields, and the hidden fields it carried (from the link, such as `utm_source`). Both are private |
| `featured`, `pinOrder` | Whether you starred it, and its place among pinned testimonials |
| `consent.public` | `false` when the author asked to keep it private. It's never published |
| `trashedAt` | When it went to the trash, or `null` |

**Media URLs** (`avatarUrl`, `companyLogoUrl`, `video.url`, `originalUrl`, `posterUrl` and `images[].url`) work for anyone only while the testimonial is approved and not withdrawn. Before that, and after a rejection or withdrawal, they return `404` unless the request carries your API key (`Authorization: Bearer plk_…`) or comes from the signed-in dashboard.

### Adding a testimonial

```bash
curl -X POST https://plaudit.example.com/api/v1/projects/acme/testimonials \
  -H "Authorization: Bearer plk_…" -H "Content-Type: application/json" \
  -d '{"name":"Grace Hopper","text":"Shipped it in a day.","rating":5,"tags":["sales"],"consent":true}'
```

`consent: true` is required. It confirms that the person agreed to publication, and it's recorded in the consent ledger as given via the API. Optional fields are `email`, `title`, `company`, `headline`, `website` (the author's site), `platform`, `sourceUrl`, `sourceDate` (`2026-10-12` or a full ISO timestamp), `datePrecision`, `language`, `customFields` (an object of up to 50 keys, each a string, number, boolean or `null`), `status` (`pending` or `approved`) and `consentScopes` (any of `website`, `social`, `ads`, `name` and `face`; `website` is always included).

### Editing a testimonial

Besides the fields in the table above, `PATCH /testimonials/{id}` accepts `headline`, `authorWebsite`, `authorPhone`, `authorSocials` (`{ "x", "linkedin", "instagram", "tiktok" }`), `sourceUrl`, `sourceDate`, `datePrecision`, `platform`, `language`, `customFields`, `isFeatured` and `pinOrder`. Send `null` (or `""`) to clear a text field. Changing what the author wrote (the text, headline, rating, or their name, title or company) marks it **edited after consent** and logs it, as in the dashboard.

### Hidden, trash and restore

`PATCH` can set `status` to `hidden` (kept for your own use, never public). The API can't move a testimonial to the trash: `DELETE /testimonials/{id}` still deletes it at once, files and all. Testimonials someone moved to the trash in the dashboard are left out of lists unless you ask for `status=trashed`, and they show `"status": "trashed"`.

The dashboard's own endpoints (signed-in session, same-origin requests only) are not part of the versioned API and may change, but for reference: `POST /api/admin/testimonials/{id}/trash` moves one to the trash, remembering its status, and `POST /api/admin/testimonials/{id}/restore` puts it back (a withdrawn one as `rejected`). Both answer `{ "testimonial": … }` and send `testimonial.trashed` or `testimonial.restored`. The inbox also uses `GET /api/admin/projects/{id}/testimonials` (the view's query, as in the dashboard's address bar), `POST /api/admin/projects/{id}/testimonials/bulk` (`{ "action", "ids", "tags"? }`, up to 500 ids, answering `{ "updated", "skipped": [{ "id", "reason" }] }`), `GET /api/admin/projects/{id}/export?format=csv|json&<view>` and `POST /api/admin/projects/{id}/testimonials/manual`.

### Campaign invites

`POST /invites` sends someone a campaign's invitation, for example after a purchase. The campaign id is on the campaign's **Auto-collect** tab.

```bash
curl -X POST https://plaudit.example.com/api/v1/invites \
  -H "Authorization: Bearer plk_…" -H "Content-Type: application/json" \
  -d '{"campaignId":"1d85…","email":"ada@example.com","name":"Ada Lovelace","company":"Engines Ltd","variables":{"plan":"Pro"},"delayDays":3}'
```

| Field | |
|---|---|
| `campaignId`, `email` | Required |
| `name`, `company`, `title` | Optional, up to 120 characters |
| `variables` | Optional template variables for `{{key}}` in the campaign's wording: up to 20 keys (letters, digits and `_`), values up to 500 characters |
| `delayDays` | Optional, 0 to 365 (fractions allowed). The invitation is queued now and sent that much later; absent or 0 sends it straight away |

Answers:

- `201` with `{ "data": invite }` when the person is added. `data.stage` is `queued` and `data.scheduledFor` says when a delayed one goes out.
- `200` with `{ "data": invite | null, "skipped": "duplicate" | "unsubscribed" | "responded" }` when no new email is sent: the person is already in the campaign (the existing invite is returned), unsubscribed from the project, or already sent a testimonial. Retrying a call is therefore safe.
- `409` when the campaign is a draft or paused, or email isn't set up on the server; `404` for an unknown campaign.

An invite has `id`, `campaignId`, `email`, `name`, `company`, `title`, `variables`, `stage` (`not_sent`, `queued`, `sent`, `failed`, `bounced`, `opened`, `clicked`, `started`, `submitted`, `declined` or `unsubscribed`), `status`, `emailStatus`, `scheduledFor`, `sentAt`, `remindersSent`, `openedAt`, `clickedAt`, `startedAt`, `respondedAt`, `declinedAt`, `unsubscribedAt`, `testimonialId`, `link` (the personal form link) and `createdAt`.

### A campaign's incoming webhook

Tools that can only send a webhook (a shop, a CRM, n8n, Zapier or Make) can use the campaign's own URL instead of an API key. Create it on the campaign's **Auto-collect** tab. It looks like `https://plaudit.example.com/api/hooks/campaigns/cwh_…` and is shown **once**: Plaudit stores only a SHA-256 of its token. **Regenerate URL** makes a new one and the old one stops working at once; **Turn off** removes it.

```bash
curl -X POST "https://plaudit.example.com/api/hooks/campaigns/cwh_…?delay=3" \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","name":"Ada Lovelace","company":"Engines Ltd","plan":"Pro"}'
```

- The body is a JSON object with `email` (required), `name`, `company`, `title` and `delayDays`. Any other top-level field (string, number or true/false) becomes a template variable, as does a `variables` object. `?delay=<days>` works too when you can't change the body.
- It answers `202` with `{ "ok": true, "inviteId", "scheduledFor" }`, or `200` with `skipped` as above. `400` for invalid input, `404` for an unknown URL, `409` while the campaign isn't sending, `413` for a body over 16 KB, `415` unless it's `Content-Type: application/json`, and `429` beyond 120 requests a minute (per URL, and per sending address) or 2,000 a day per URL. The daily cap is a backstop in case the URL leaks; use `POST /api/v1/invites` for larger volumes.

The incoming webhook isn't part of `/api/v1` and isn't in the OpenAPI file, since it needs no key.

## Webhooks

Under **Settings → Webhooks**, add the URL of your endpoint. You can limit it to one project (or one form) and to the events you care about, and **Edit** changes the URL, events, project and form later without changing the secret or losing the delivery log. For Slack, Discord, Teams or Telegram messages, use **Settings → Notifications** instead ([docs/help/notifications.md](help/notifications.md)). Tick none to receive the **default set**: every event below except the ones marked *opt-in*, which go only to endpoints that tick them.

| Event | When |
|---|---|
| `testimonial.created` | Someone submits a testimonial (or one is added through the API) |
| `testimonial.approved` | A testimonial is approved, in the dashboard, through the API or by the project's auto-approve rule. `data.approvedBy` says which: `owner`, `api` or `auto` |
| `testimonial.rejected` | A testimonial is rejected |
| `testimonial.hidden` | A testimonial is hidden (kept, but off your site) |
| `testimonial.trashed` | A testimonial is moved to the trash (off your site) |
| `testimonial.restored` | A testimonial comes back from the trash. `data.testimonial.status` is the status it went back to |
| `testimonial.deleted` | A testimonial is deleted for good, directly or when the trash is emptied (the payload is the last state) |
| `testimonial.transcribed` | A video's transcript and captions are ready |
| `consent.withdrawn` | The author withdrew consent through their private link |
| `testimonial.updated` | *Opt-in.* Someone changed its content in the dashboard or through the API: the text, an answer, the author's details, the rating, the transcript or captions, or another field the [API can edit](#editing-a-testimonial). Status and tag changes don't send it |
| `form.submitted` | *Opt-in.* Someone sent a form (any form, including the classic page). `data` is `{ form: { id, slug, name }, testimonialId, hiddenFields }`; the testimonial itself comes with `testimonial.created` |
| `feedback.created` | *Opt-in.* Someone answered a form's private question, or a low rating sent them to private feedback (FORM-12). `data.feedback` is `{ id, formId, testimonialId, rating, text, createdAt }`, plus `source: "low-rating"` and `testimonialId: null` for the low-rating branch. Private feedback is never published |
| `import.completed` | *Opt-in.* An import from a review site or another tool finished (once per run). `data.import` is `{ id, source, platform, imported, duplicates, skipped, failed, startedAt, finishedAt }`. See [IMPORT.md](IMPORT.md) |
| `invite.sent` | *Opt-in.* A campaign or Requests-tab invitation or reminder was handed to the mail server. `data` is `{ invite, kind }`, `kind` being `invite` or `reminder`; `invite` is the shape [above](#campaign-invites) |
| `invite.opened` | *Opt-in.* The first open of a campaign email, for campaigns that track opens |
| `invite.clicked` | *Opt-in.* The first click on the personal link in a campaign email |
| `invite.declined` | *Opt-in.* The person pressed "No thanks" in a campaign email. Reminders stop |
| `ping` | You pressed **Send test event** |

Every way a testimonial leaves your site (rejected, hidden, trashed, deleted or withdrawn) is in the default set, so an endpoint that mirrors your testimonials elsewhere can always take them down. Hiding sends `testimonial.hidden`, never `testimonial.rejected`. The one exception is deleting a whole project: that sends no per-testimonial events, and the project's own webhooks are deleted with it, so treat a project missing from `GET /projects` as taking down all of its testimonials.

Imports (CSV, archive or a review site) don't send per-testimonial webhooks; a review-site import sends one `import.completed` to hooks that select it.

A webhook can belong to **one form** (set in the form builder's Settings, or `formId` when you create it through the dashboard's API): it then receives only that form's testimonial events and its `form.submitted` and `feedback.created`.

When auto-approve approves a new testimonial, you get `testimonial.created` (with `status: "pending"`) and then `testimonial.approved` (with `"approvedBy": "auto"`). For a text testimonial the two are queued together; for a video, `approved` comes once the video has been processed. Deliveries are first attempted in the order they were queued, but a retry can arrive after a later event, so use `createdAt` or the testimonial's `updatedAt` if order matters to you.

Each delivery is a `POST` with a JSON body:

```json
{
  "id": "d1c3…",
  "event": "testimonial.approved",
  "createdAt": "2026-10-22T10:02:11.000Z",
  "project": { "id": "9e1f…", "slug": "acme", "name": "Acme", "collectUrl": "…", "wallUrl": "…", "createdAt": "…" },
  "data": { "testimonial": { "…": "same shape as the REST API" }, "approvedBy": "auto" }
}
```

`data.approvedBy` is only on `testimonial.approved`. The project includes its settings, as in the REST API:

```json
"autoApprove": { "enabled": true, "minRating": 4, "includeVideo": false }
```

and these headers:

| Header | Value |
|---|---|
| `Plaudit-Event` | The event name |
| `Plaudit-Delivery` | The delivery id (the same on retries, so you can ignore duplicates) |
| `Plaudit-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256>` |
| `User-Agent` | `Plaudit-Webhooks/1` |

**Delivery rules**

- Any 2xx response counts as delivered.
- Anything else, including redirects (which are never followed) and no response within 10 seconds, is retried: after about 30 s, 2 min, 8 min, 32 min and 2 h. That's 6 attempts over roughly 3 hours.
- Every attempt shows in the endpoint's **Recent deliveries** list, with its status code and duration. You can **Redeliver** from there.
- Pausing an endpoint stops new deliveries to it.

Webhook URLs on your private network are allowed (for example n8n running next to Plaudit), because only you can add them.

## Verifying webhook signatures

The signature is `HMAC-SHA256(secret, "<t>.<raw request body>")` in hex, where `t` is the timestamp from the same header. Find the secret under the endpoint (**Reveal**); **Rotate** replaces it.

Always verify against the **raw body bytes**, before parsing the JSON, and reject old timestamps to stop replays.

**Node.js**

```js
const crypto = require("node:crypto");

function verifyPlaudit(secret, signatureHeader, rawBody, toleranceSec = 300) {
  const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1 || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

**Python**

```python
import hashlib, hmac, time

def verify_plaudit(secret: str, signature_header: str, raw_body: bytes, tolerance: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in signature_header.split(","))
    t = int(parts.get("t", "0"))
    if abs(time.time() - t) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```

## Connecting n8n

1. In n8n, add a **Webhook** node: method `POST`, response `Immediately`. Copy its production URL.
2. In Plaudit, under **Settings → Webhooks**, add that URL. Pick the events you want, then press **Send test event**. The delivery should show `200 OK`, and n8n receives a `ping`.
3. To check the signature in n8n, turn on the Webhook node's **Raw Body** option and add a **Code** node using the Node.js function above. Your n8n version must allow the `crypto` module in Code nodes. Then branch on `event`. For example, on `testimonial.approved`, post `data.testimonial.text` to Slack, or add `data.testimonial.author.email` to your CRM.
4. To call Plaudit from n8n, use an **HTTP Request** node with header `Authorization: Bearer plk_…`, or import `/api/v1/openapi.json`.

Zapier ("Webhooks by Zapier → Catch Hook"), Make ("Custom webhook") and Activepieces ("Webhook trigger") work the same way. These steps describe n8n's standard nodes and haven't been run against a live n8n instance as part of Plaudit's tests. The signature scheme itself is covered by the automated tests.

## Public widget feed

What `widget.js` reads. No key is needed, responses are CORS-enabled (`Access-Control-Allow-Origin: *`) and cached for 60 seconds, and they carry public fields only: never an email address, phone number, consent record, custom or hidden field.

- **`GET /api/widget/<project-slug>`** (`?tag=&limit=`): `{project, testimonials}`, unchanged from earlier versions.
- **`GET /api/widget/w_<id>`**: a saved widget (preview flag `widgets` for the studio; the feed itself is always on). Returns

  ```json
  {
    "project": { "name": "Acme", "slug": "acme", "accentColor": "#0f766e" },
    "widget": { "id": "w_abc123def456", "layout": "carousel", "sort": null, "design": { "theme": "dark", "accent": "#0f766e", "onAccent": "#ffffff", "...": "…" }, "options": { "...": "…" }, "labels": { "...": "…" }, "cta": null, "aggregate": { "show": true }, "wallUrl": "/wall/acme" },
    "testimonials": [{ "id": "…", "name": "Ada", "rating": 5, "text": "…", "video": null, "tags": [], "createdAt": "…", "extra": { "headline": null, "date": "…", "datePrecision": "day", "platform": null, "sourceUrl": null, "verified": true, "images": [], "companyLogoUrl": null, "highlights": [] } }],
    "aggregate": { "count": 12, "average": 4.8 }
  }
  ```

  Each testimonial has the same fields as the slug feed plus `extra`. The widget's filters, picks and pins are applied on the server before the limit; its filters, picked ids and form id are never sent. With **first name only** on, the surname never leaves the server. A deleted widget answers `{"project": null, "widget": null, "testimonials": [], "aggregate": {"count": 0, "average": null}}`; an unknown id answers 404.
- **`GET /api/widget/w_<id>/html`** (`?jsonld=1`): the same widget as escaped HTML for a server-side include ([`EMBED.md`](EMBED.md#seo-html-include)).

Widgets are managed in the dashboard; there is no `/api/v1` endpoint for them yet.

## Walls and review snippets

Public, no key needed (preview flag `walls` for the dashboard pages; these endpoints are always on).

- **`GET /api/walls/<wall-id>/items?tab=<n>&offset=<n>`**: the next page of a published wall's tab, for "load more": `{items, total, nextOffset}`, where `items` has the same shape as the widget feed's `testimonials` and `nextOffset` is `null` on the last page. Same-origin use; cached for 60 seconds. A draft or unknown wall answers 404.
- **`GET /wall/<project>/<wall>/opengraph-image`**: the wall's 1200×630 PNG link preview. 404 for drafts.
- **`GET /schema/s_<id>.js`**: a review snippet's script. It adds a `<script type="application/ld+json" data-plaudit-schema="s_…">` block to `document.head` once, with up to 10 reviews and the `AggregateRating`. `text/javascript`, CORS `*`, cached for 5 minutes. An unknown or deleted snippet answers 404 with a JavaScript comment, so the page carries on.

Walls and snippets are managed in the dashboard; there is no `/api/v1` endpoint for them yet.

## Review booster pages

Public, no key needed (feature flag `booster` for the dashboard pages; these are always on). See [the guide](help/booster.md).

- **`GET /b/<project>/<page>`**: a public booster page, as plain HTML (no scripts). A draft or unknown page answers 404. Old project and page addresses answer 308 to the current one, with the query kept.
- **`GET /b/<project>/<page>/go/<link-id>`**: counts one click for that link today (UTC) and answers 302 to the link's stored address. The address always comes from the saved page, never from the request, so it can't redirect anywhere else; an unknown link is a 404. Only a daily count per link is stored. 60 clicks per visitor address per 10 minutes, then 429.

Booster pages are managed in the dashboard; there is no `/api/v1` endpoint for them yet.

## Form submissions: rewards and low ratings

The public form endpoint (`POST /api/projects/<project>/forms/<form>/submissions`, used by the form and its embeds) answers with two extra keys when they apply:

- **`reward`** (FORM-13), when the form gives one: `{ status: "given", title, message, code, url, wheel? }` or `{ status: "sold_out", title, message }` once a unique-code list has run out. `wheel` is `{ labels, chances, won }`: the server spins it, and only the prize won carries a code. The reward never depends on the rating or the words.
- **`feedbackOnly: true`** (FORM-12), when the form's low-rating branch stored the submission as private feedback; `withdrawUrl` is then `null`. Such a submission sends `{ rating, lowFeedback, person: { name?, email? }, requestToken?, hiddenFields?, language? }` instead of answers and consent.

A form with neither answers exactly as before.
