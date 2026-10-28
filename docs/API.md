# REST API and webhooks

Plaudit has a small REST API and signed webhooks, so you can connect it to n8n, Zapier, Make, Activepieces or your own scripts. Both are free and have no plan limits.

- [REST API](#rest-api)
- [Forms, widgets, walls, campaigns and more](#forms-widgets-walls-campaigns-and-more) (flag `api2`)
- [Analytics](#analytics)
- [Webhook subscriptions (REST hooks)](#webhook-subscriptions-rest-hooks)
- [MCP server for AI assistants](#mcp-server-for-ai-assistants)
- [Stripe and Shopify triggers](#stripe-and-shopify-triggers)
- [Webhooks](#webhooks)
- [Verifying webhook signatures](#verifying-webhook-signatures)
- [Connecting n8n](#connecting-n8n)
- [Public widget feed](#public-widget-feed)
- [Walls and review snippets](#walls-and-review-snippets)
- [Testimonial pages](#testimonial-pages)
- [Dashboard endpoints: video tools and the image studio](#dashboard-endpoints-video-tools-and-the-image-studio)
- [Dashboard endpoints: imports, customers, merging, translations and smart search](#dashboard-endpoints-imports-customers-merging-translations-and-smart-search)

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

With the `team2` flag, a key can be made for one project (**Reaches** when creating it). It then sees and changes only that project: other projects' ids answer `404`, as if they didn't exist, and `GET /projects` lists only its own. Keys made without a project (and every key from before) reach every project.

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

With the `api2` flag on (the default), there are also paths for forms, widgets, walls, campaigns and their recipients, tags, customers, private feedback and analytics: see [below](#forms-widgets-walls-campaigns-and-more).

Errors look like `{ "error": "…" }`, with status `400` (invalid input), `401` (missing or invalid key), `403` (read-only key), `404`, `409` (for example, re-publishing a testimonial whose author withdrew consent, or approving one whose author asked to keep it private), `413` (a body over the limit) or `429`.

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

**Media URLs** (`avatarUrl`, `companyLogoUrl`, `video.url`, `originalUrl`, `posterUrl` and `images[].url`) work for anyone only while the testimonial is approved and not withdrawn. Before that, and after a rejection or withdrawal, they return `404` unless the request carries your API key (`Authorization: Bearer plk_…`) or comes from the signed-in dashboard. A key made for one project, or a team member limited to some projects, gets only the files of those projects; the rest answer `404` as well.

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

## Forms, widgets, walls, campaigns and more

_Behind the `api2` flag, on by default. With it off, these paths answer `404` and `openapi.json` leaves them out; everything above works exactly as before._

Each path does what the same button in the dashboard does, with the same checks: a form's config is validated like the builder's save, a widget's or wall's connected form must be in the same project, starting a campaign needs email set up, the default form can't be deleted, and so on. A refusal answers with the dashboard's own message and status (`400`, `404` or `409`). Bodies are JSON, at most 256 KB for forms, widgets and walls (their configs), 1 MB for recipients and 16 KB for everything else. Ids from another project answer `404`, as if they didn't exist.

| Method and path | Scope | What it does |
|---|---|---|
| `GET /projects/{slug}/forms` | read | The project's forms, default first, each with `stats` (submissions, invites, responded, responseRate) and `links` (the form's address and its inline, popup and iframe snippets) |
| `POST /projects/{slug}/forms` | write | A new step-by-step form: `{ name, slug?, template? }` (`saas`, `course`, `coaching`, `agency`, `ecommerce`, `local`, `employee` or `event`) |
| `GET /forms/{id}` | read | One form, with its whole `config` (`pages`, `design`, `labels`, `settings`) and `reward` |
| `PATCH /forms/{id}` | write | `name`, `language`, `status` (`live` or `paused`), `slug` (the old link keeps working), `isDefault: true`, and whole config parts: `pages`, `design`, `labels`, `settings`, `reward`. Each part sent replaces that part whole. A classic form refuses what the classic page can't show (`409`) |
| `DELETE /forms/{id}` | write | Deletes a form; its testimonials stay. The default form can't be deleted (`409`) |
| `GET /projects/{slug}/widgets` | read | Saved widgets, each with `config` and `embed`: `script`, `iframe`, `hosted`, `react`, `html` (the [SEO include](EMBED.md#seo-html-include)) and `htmlWithJsonLd` |
| `POST /projects/{slug}/widgets` | write | `{ name, layout?, placement?, connectedFormId?, config? }`; layouts `grid`, `list`, `carousel`, `slider`, `marquee`, `featured`, `badge`, `toast` |
| `GET`, `PATCH`, `DELETE /widgets/{id}` | read, write, write | One widget. `PATCH` takes `name`, `placement`, `connectedFormId` and `config` (the whole config, as the studio saves it). `DELETE` is the dashboard's: pages that still embed it show nothing |
| `GET /projects/{slug}/walls` | read | The project's walls, with `url` (its own address) and `publicUrl` (where visitors see it) |
| `POST /projects/{slug}/walls` | write | A new wall, as a draft: `{ name, slug?, theme? }` (`paper`, `night`, `sunrise`, `meadow`, `studio`) |
| `GET`, `PATCH`, `DELETE /walls/{id}` | read, write, write | One wall. `PATCH` takes `name`, `theme`, `published`, `main` (shown at `/wall/<project>`), `slug` (the old link keeps working), `featuredTestimonialId`, `connectedFormId` and `config` (whole) |
| `GET /projects/{slug}/campaigns` | read | Campaigns, newest first, each with its `funnel` |
| `POST /projects/{slug}/campaigns` | write | A new draft with the default wording: `{ name, formId? }` |
| `GET /campaigns/{id}` | read | One campaign and its funnel. `webhook.on` says whether its incoming webhook URL is on; the URL itself is only ever shown in the dashboard |
| `PATCH /campaigns/{id}` | write | `name`, `formId`, `senderName`, `replyTo`, `subject`, `body`, `buttonText`, `rtl`, `reminders` (up to three day offsets), `trackOpens`, `rewardCodes`, and `status`: `active` starts it, queuing an invitation for everyone not yet sent one (`409` when email isn't set up), `paused` stops sends and reminders |
| `DELETE /campaigns/{id}` | write | Deletes it and its recipients (their links stop working); testimonials stay |
| `GET /campaigns/{id}/recipients` | read | Recipients, newest first, as [invites](#campaign-invites). `limit` and `offset` as for testimonials; the answer has `pagination` |
| `POST /campaigns/{id}/recipients` | write | Adds people, like the campaign's **Add people**: `{ "source": "paste", "text": "…" }` (lines or a CSV), `{ "source": "customers", "ids": […] }` or `{ "source": "manual", "person": { email, name?, company?, title? } }`. Answers `{ data: [invites], skipped: [{ line, email, text, reason, detail }], rows }`, `reason` being `invalid`, `duplicate`, `unsubscribed` or `responded`. Up to 5,000 rows at a time |
| `GET /projects/{slug}/tags` | read | `[{ name, count }]` |
| `PATCH /projects/{slug}/tags` | write | `{ "action": "rename", "from", "to" }` or `{ "action": "merge", "from": […], "into" }`, on every testimonial at once. Answers the tags as they now are |
| `DELETE /projects/{slug}/tags?name=…` | write | Removes the tag from every testimonial and the project |
| `GET /projects/{slug}/customers` | read | The people behind the testimonials, by name: `{ id, email, name, title, company, website, avatarUrl, socials, custom }`. `?email=` finds one. Paged |
| `GET /customers/{id}` | read | One customer |
| `GET /projects/{slug}/feedback` | read | Private feedback (answers to private questions, and low ratings sent to private feedback), newest first: `{ id, formId, customerId, testimonialId, source, rating, text, author: { name, email }, createdAt }`. It's never published. Paged |

Lists of testimonials, recipients, customers and feedback take `limit` (1 to 100, default 50) and `offset`; the others return everything.

**Keys and projects.** Each of these paths checks the key against the project an id belongs to: a key made for one project ([above](#keys)) gets `404` for everything else.

Changes made with a key (testimonials, campaigns started, paused or deleted, tags, webhook subscriptions) are in the dashboard's [audit log](AUTH.md#the-audit-log), under the key's name.

## Analytics

_Also `api2`, and `404` when analytics is off on the server (`ANALYTICS=off`, or the `analytics` flag)._

| Method and path | Scope | What it does |
|---|---|---|
| `GET /projects/{slug}/analytics?from=&to=` | read | The analytics dashboard's numbers for one project: `range` and `previousRange`, `tiles` (new testimonials, the review backlog, average rating, widget, wall and form views and clicks, booster clicks, the invite funnel, each with the period before), `series` (views by day) and `tables` of widgets, forms and walls |
| `GET /analytics/{type}/{id}?from=&to=` | read | One object's panel, `type` being `widget`, `form`, `wall`, `snippet` or `testimonial`: `current` and `previous` totals (views, visitors, clicks, starts, completions, completion rate, renders), daily `series`, `topPages` for widgets, the per-page `funnel` and ratings for forms, `sites` for snippets, and `install` for widgets |

`from` and `to` are days (`2026-10-01`, UTC), both included. Without them it's the last 30 days; `to` never goes past today and a range is at most 731 days. Anything that isn't a date is a `400`. Visitors are counted per day, and nothing in these numbers identifies anyone ([what's collected](help/analytics.md)).

```bash
curl -H "Authorization: Bearer plk_…" "https://plaudit.example.com/api/v1/projects/acme/analytics?from=2026-10-01&to=2026-10-27"
```

## Webhook subscriptions (REST hooks)

_Flag `api2`._ Tools such as Zapier subscribe and unsubscribe themselves:

| Method and path | Scope | What it does |
|---|---|---|
| `POST /webhooks` | write | `{ "url", "events": [...], "project"? }`: a signed webhook for those events (at least one), for one project (by slug) or all. Answers `201` with `{ id, url, events, project, active, createdAt, secret }`; the secret is in this answer only |
| `GET /webhooks` | read | The subscriptions this key made (no secrets) |
| `DELETE /webhooks/{id}` | write | Unsubscribes. Only the key that made a subscription can delete it here |

A subscription is an ordinary [webhook](#webhooks): the same events, payloads, `Plaudit-Signature`, retries and delivery log. It shows in **Settings → Webhooks** marked "added through the API", where an admin can edit or delete it. Unlike webhooks added in the dashboard, it may only point at a **public address**: it's checked when subscribing and again when each delivery connects, so a leaked key can't aim your server at your own network. A key limited to one project must name it. Up to 50 per key.

## MCP server for AI assistants

`/mcp` (flag `mcp`) is a [Model Context Protocol](https://modelcontextprotocol.io) server over Streamable HTTP, with an API key or an OAuth access token as the bearer token: JSON-RPC 2.0 `POST`s for `initialize`, `ping`, `tools/list` and `tools/call`, answered with JSON. Its tools are `list_testimonials`, `search_testimonials`, `get_testimonial`, `get_embed_codes`, `summarize` and, for read-and-write keys only, `create_invite`. Testimonials go to the assistant without the author's email, phone, consent details or private fields. Setup for Claude Desktop and other clients: [help/mcp.md](help/mcp.md).

**OAuth 2.1.** Connectors that sign in by themselves (Claude.ai, ChatGPT) use OAuth instead of a key. A request without a token answers `401` with `WWW-Authenticate: Bearer realm="plaudit", resource_metadata="…/.well-known/oauth-protected-resource/mcp"`, and from there:

| Endpoint | Standard | What it does |
|---|---|---|
| `GET /.well-known/oauth-protected-resource` (and `…/mcp`) | RFC 9728 | The resource (`<server>/mcp`), its authorization server and scopes `plaudit:read`, `plaudit:write` |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 | The endpoints below; `S256` only, public clients only |
| `POST /api/oauth/register` | RFC 7591 | Registers a public client: `{ redirect_uris, client_name? }`. Redirect URIs must be `https://`, or `http://` to `localhost`, `127.0.0.1` or `[::1]`, without a fragment. 20 an hour per address |
| `GET /oauth/authorize` | OAuth 2.1 | `response_type=code`, `client_id`, `redirect_uri` (exactly as registered), `code_challenge` with `code_challenge_method=S256`, `state`, `scope`, `resource`. An unknown client or redirect URI gets an error page here, never a redirect. A member signs in and approves on a consent page: read, or read and send invitations (editors and up), and every project or some |
| `POST /api/oauth/token` | OAuth 2.1 | `grant_type=authorization_code` (`code`, `client_id`, `redirect_uri`, `code_verifier`) or `refresh_token` (`refresh_token`, `client_id`), form-encoded. Access tokens (`plo_…`) last an hour; refresh tokens (`plr_…`) 30 days and change on every use. Using a refresh token twice revokes the connection |
| `POST /api/oauth/revoke` | RFC 7009 | `token=…`: a refresh token ends the connection, an access token just itself |

A token acts as the member who approved it, with their role and projects as they are now (a member who's removed, or demoted to viewer, loses what they no longer have), within the scope and projects they chose. Codes and tokens are stored as hashes. Admins see and disconnect connections under **Settings → API keys**; connecting and disconnecting are in the audit log.

## Stripe and Shopify triggers

_Flag `campaigns`._ A campaign's native triggers ([help/campaigns.md](help/campaigns.md#stripe-and-shopify)) have endpoints of their own, which need no key: every delivery must carry the shop's signature.

- **`POST /api/hooks/stripe/<trigger id>`**: checks `Stripe-Signature` (HMAC-SHA256 of `<t>.<raw body>` with the endpoint's signing secret, any `v1`, `t` within 5 minutes). Acts on `checkout.session.completed` once `payment_status` is `paid` (or `no_payment_required`), using `customer_details.email` and `name`, and on `invoice.paid`, using `customer_email` and `customer_name`.
- **`POST /api/hooks/shopify/<trigger id>`**: checks `X-Shopify-Hmac-Sha256` (base64 HMAC-SHA256 of the raw body) and acts on the `X-Shopify-Topic` `orders/fulfilled` or `orders/paid`, using the order's `email` (or `contact_email`, or the customer's), the customer's name and the billing company.

Answers: `200` `{ ok, inviteId, scheduledFor }` (or `skipped`, as for [invites](#campaign-invites)); `200` with `ignored` for events the trigger doesn't act on, unpaid sessions and orders without an email; `200` `{ duplicate: true }` for a delivery already handled (by Stripe's event id or `X-Shopify-Webhook-Id`); `400` for a wrong signature or invalid JSON; `404` for an unknown trigger; `409` until the trigger has its secret, or while the campaign isn't sending (the shop retries later); `413` past 256 KB; `429` past 120 a minute or 2,000 a day per trigger. The dashboard manages triggers at `GET`/`POST /api/admin/campaigns/{id}/triggers` and `PATCH`/`DELETE …/triggers/{triggerId}`; the secret is never sent back (`secretSet: true`).

```bash
curl -X POST https://plaudit.example.com/mcp -H "Authorization: Bearer plk_…" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"summarize","arguments":{"project":"acme"}}}'
```

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
| `import.completed` | *Opt-in.* An import from a review site or another tool finished (once per run). `data.import` is `{ id, source, platform, imported, duplicates, skipped, failed, startedAt, finishedAt }`, plus `syncId` for a run of a synced source (IMP-02), which sends it only when the run added testimonials. See [IMPORT.md](IMPORT.md) |
| `invite.sent` | *Opt-in.* A campaign or Requests-tab invitation or reminder was handed to the mail server. `data` is `{ invite, kind }`, `kind` being `invite` or `reminder`; `invite` is the shape [above](#campaign-invites) |
| `invite.opened` | *Opt-in.* The first open of a campaign email, for campaigns that track opens |
| `invite.clicked` | *Opt-in.* The first click on the personal link in a campaign email |
| `invite.declined` | *Opt-in.* The person pressed "No thanks" in a campaign email. Reminders stop |
| `widget.installed` | *Opt-in.* A saved widget was seen on a website for the first time, or again after `widget.removed` (DISP-13). Checked hourly. `data` is `{ widget: { id, name, layout }, page: { url, origin, path }, lastSeenAt }`; the page never has a query string. Views on Plaudit's own hosted link don't count |
| `widget.removed` | *Opt-in.* A widget that was live has had no views from any page for 7 days. Same `data`, with the last page it was seen on. People who turned on the matching email in **Settings → Notifications** get one too |
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

Ready-made versions: two n8n workflows and a Make blueprint in [`integrations/`](../integrations/README.md) (approved testimonials to Slack with the signature checked; invites after a purchase), and a Zapier app whose triggers poll the API ([help/integrations.md](help/integrations.md)).

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
  `widget.css` is the widget's own cleaned CSS (DISP-08, `""` when there is none), which `widget.js` appends inside the shadow root ([`EMBED.md`](EMBED.md#custom-css)).
  `?l=<language>` is the visitor's browser language (`widget.js` sends `navigator.language`). For a widget set to show translations (INBOX-13), each testimonial with a stored translation into that language (or its base language: `fr` for `fr-CA`) has its `text` and `extra.headline` replaced, and `extra.highlights` emptied, since they point into the original words. Other widgets ignore it. Nothing is translated on the fly.
- **`GET /api/widget/w_<id>/html`** (`?jsonld=1`): the same widget as escaped HTML for a server-side include ([`EMBED.md`](EMBED.md#seo-html-include)).

Widgets are managed in the dashboard, or through [`/api/v1/projects/{slug}/widgets`](#forms-widgets-walls-campaigns-and-more) (flag `api2`).

## Walls and review snippets

Public, no key needed (preview flag `walls` for the dashboard pages; these endpoints are always on).

- **`GET /api/walls/<wall-id>/items?tab=<n>&offset=<n>`**: the next page of a published wall's tab, for "load more": `{items, total, nextOffset}`, where `items` has the same shape as the widget feed's `testimonials` and `nextOffset` is `null` on the last page. Same-origin use; cached for 60 seconds. A draft or unknown wall answers 404.
- **`GET /wall/<project>/<wall>/opengraph-image`**: the wall's 1200×630 PNG link preview. 404 for drafts.
- Wall pages send their own `Content-Security-Policy`: the public policy, plus exactly the script, connect and image hosts of the analytics provider the owner chose for that wall (WALL-07; Plausible or Google Analytics 4), if any.
- **`GET /schema/s_<id>.js`**: a review snippet's script. It adds a `<script type="application/ld+json" data-plaudit-schema="s_…">` block to `document.head` once, with up to 10 reviews and the `AggregateRating`. `text/javascript`, CORS `*`, cached for 5 minutes. An unknown or deleted snippet answers 404 with a JavaScript comment, so the page carries on.

Walls are managed in the dashboard or through [`/api/v1/projects/{slug}/walls`](#forms-widgets-walls-campaigns-and-more) (flag `api2`); snippets only in the dashboard so far.

## Testimonial pages

Public, no key (they follow the `walls` flag). See [Sharing](help/share.md).

- **`GET /t/<id>`**: one testimonial's own page (WALL-04), server-rendered with JSON-LD (`Review`) and Open Graph tags. `<id>` is the testimonial's id (a random UUID). Only for testimonials that are approved, not withdrawn and whose author didn't keep them private; anything else answers 404, exactly like an id that doesn't exist.
- `?lang=<language>` on `/t/<id>` (with the `translations` flag) shows its stored translation into that language, if any.
- **`GET /t/<id>/opengraph-image`**: its 1200×630 PNG link preview, revalidated on every fetch (`Cache-Control: public, no-cache`), so a takedown removes it at once. 404 under the same rule.

## Video uploads

The recorder and the dashboard upload videos in pieces, so a dropped connection or a reverse proxy's body limit doesn't lose a recording. These are the app's own endpoints, not part of the versioned API, and may change.

- **`POST /api/projects/{slug}/uploads`** (a collection page; `?form=&question=` for a form's answer) or **`POST /api/admin/uploads`** `{ "kind": "video", "projectId" }` (the dashboard) starts a session: `{ id, token, offset, chunkSize }`. Send `{ "size" }` when it's known, so a file over `MAX_VIDEO_MB` is refused (`413`) before a byte is sent. Every call below needs the `X-Upload-Token: <token>` header.
- **Relayed** (the default): **`PUT /api/uploads/{id}?offset=N`** with the next bytes answers `{ offset }`, or `409 { offset }` when `N` is stale; **`GET /api/uploads/{id}`** says where to resume; **`DELETE`** abandons it. A first chunk that isn't a video answers `415`.
- **Direct to the bucket** (`STORAGE_DRIVER=s3` with `S3_DIRECT_UPLOADS=true`): also send `{ "direct": true, "contentType" }` when starting, and the answer has `direct: { partSize }`. For each part, **`POST /api/uploads/{id}/parts`** `{ "partNumber", "size" }` answers `{ url, headers, expiresIn }`: PUT exactly `size` bytes there with exactly those headers within ten minutes. Every part but the last must be `partSize` bytes. Then **`POST /api/uploads/{id}/complete`** answers `{ offset }` (the size) once the server has checked the file, or `413`/`415` and the upload is gone. If a PUT to the bucket fails, carry on with relayed `PUT`s on the same session from offset 0. Without the setting, `direct` is ignored.
- A finished upload is used by naming `{ id, token }` in the submission (`videoUpload` and `videoUploadToken` on the classic page) or in a dashboard call. Unfinished sessions expire after 24 hours.

## Dashboard endpoints: video tools and the image studio

Like the inbox's, these are the dashboard's own (signed-in session, same-origin requests only), not part of the versioned API, and may change. Every change goes through the normal edit path: it's in the testimonial's history and sends the opt-in `testimonial.updated` webhook.

**Video tools** (VID-01..04, [guide](help/video.md)):

- **`GET /api/admin/testimonials/{id}/trim`**: `{ durationMs, peaks, startMs, endMs }`, the original's length, 240 loudness peaks (0–1) and the current trim. Needs ffmpeg (409 without it).
- **`PUT /api/admin/testimonials/{id}/trim`**: `{ "startMs": int|null, "endMs": int|null }`, whole milliseconds of the original; both `null` shows the whole video. Checked against the original's real length (at least 1 s kept). Answers `{ testimonial }` with `mediaStatus: "queued"`; the MP4 is re-cut in the background. Captions stay in the original's timing and are cut and shifted when served at `/api/captions/{id}`.
- **`POST /api/admin/testimonials/{id}/poster`**: JSON `{ "atMs": int }` uses that frame of the served video; multipart `file` (PNG, JPEG, WebP or GIF, sniffed, size-capped) uses an image. **`DELETE`** goes back to the default frame.
- **`POST /api/admin/testimonials/{id}/video`**: `{ "upload": { "id", "token" } }`, a finished resumable upload started with `POST /api/admin/uploads` `{ "kind": "video", "projectId" }`. Replaces the video, clears the trim and poster, reruns conversion and transcription, and deletes the old files.
- **`GET /api/admin/testimonials/{id}/download?file=original|mp4`**: the file as an attachment (`Content-Disposition: attachment`, `Cache-Control: private, no-store`). 401 when signed out; 404 for `mp4` before it's converted.

**Image studio** (SHARE-01..03, [guide](help/share.md)). A design is `{ template, size: { preset, width, height }, theme, accent, highlight, text, font, background: { kind, color, color2, angle, pattern, assetId, dim }, logo: { source, assetId, position, size }, showRating, showAvatar, showTitle }`; items are `[{ id, text?, name?, byline? }]` (1 to 6 of the project's testimonials; the overrides are for the image only).

- **`POST /api/admin/projects/{id}/share/render`**: `{ design, items, format: "png"|"jpeg", download? }` answers the image (`private, no-store`). JPEG needs ffmpeg (501 without it).
- **`POST /api/admin/projects/{id}/share/zip`**: `{ renders: [{ design, items }], format }`, up to 12 images in one `application/zip`.
- **`GET|POST /api/admin/projects/{id}/share/assets`**: list, or upload a multipart `file` (PNG or JPEG, sniffed, size-capped) with `kind` `background` or `logo`. **`DELETE /api/admin/share-assets/{assetId}`** removes one and its file.
- **`GET|POST /api/admin/projects/{id}/share/templates`**: "my templates", `{ name, design }`. **`PATCH|DELETE /api/admin/share-templates/{templateId}`**.

## Review booster pages

Public, no key needed (feature flag `booster` for the dashboard pages; these are always on). See [the guide](help/booster.md).

- **`GET /b/<project>/<page>`**: a public booster page, as plain HTML (no scripts). A draft or unknown page answers 404. Old project and page addresses answer 308 to the current one, with the query kept.
- **`GET /b/<project>/<page>/go/<link-id>`**: counts one click for that link today (UTC) and answers 302 to the link's stored address. The address always comes from the saved page, never from the request, so it can't redirect anywhere else; an unknown link is a 404. Only a daily count per link is stored. 60 clicks per visitor address per 10 minutes, then 429.

Booster pages are managed in the dashboard; there is no `/api/v1` endpoint for them yet.

## Analytics beacons

Public, no key, cookieless ([what's collected](help/analytics.md)). Each answers `204` with an empty body and `Access-Control-Allow-Origin: *`, whatever it was sent: anything that isn't in the shape below, or names an unknown, deleted or draft object, is dropped without saying so. Bodies are JSON sent as `text/plain` (so browsers send them without a CORS preflight), at most 2 KB (`413` past that). Each IP address may send 600 in 10 minutes (`429` past that; the address is kept in memory only). With `ANALYTICS=off` they store nothing.

- **`POST /api/widget/w_<id>/seen`**: from `widget.js` (DISP-13, DISP-14). `{ "k": "view" | "more" | "source" | "cta" | "play", "u": "<page address>" }`. `widget.js` sends a view once per page load, and sends the clicked element's class (`rm`, `src`, `b`, `bd`) as `k` to stay small; both forms are accepted. The address is stored as its origin and path only; without `u`, the `Origin` header is used.
- **`POST /api/collect`**: walls and step-by-step forms (WALL-05, FORM-15). `{ "t": "wall", "id": "<wall id>", "k": "view" | "cta" | "link" }` or `{ "t": "form", "id": "<form id>", "k": "view" | "start" | "step", "s": <page index> }`, or, from a testimonial's own page (WALL-04), `{ "t": "testimonial", "id": "<testimonial id>", "k": "view" | "cta" | "share" }`. Completions aren't accepted here: the server counts them when a form is sent.

The server also counts, by itself, views of the classic `/c/<project>` page, every form submission, and each fetch of `/schema/s_<id>.js` (SEO-04, with the referring site's origin; crawlers included).

The numbers are read in the dashboard (`/admin/analytics`) or through [the API](#analytics) (flag `api2`).

## Form submissions: rewards and low ratings

The public form endpoint (`POST /api/projects/<project>/forms/<form>/submissions`, used by the form and its embeds) answers with two extra keys when they apply:

- **`reward`** (FORM-13), when the form gives one: `{ status: "given", title, message, code, url, wheel? }` or `{ status: "sold_out", title, message }` once a unique-code list has run out. `wheel` is `{ labels, chances, won }`: the server spins it, and only the prize won carries a code. The reward never depends on the rating or the words.
- **`feedbackOnly: true`** (FORM-12), when the form's low-rating branch stored the submission as private feedback; `withdrawUrl` is then `null`. Such a submission sends `{ rating, lowFeedback, person: { name?, email? }, requestToken?, hiddenFields?, language? }` instead of answers and consent.

A form with neither answers exactly as before.

## Dashboard endpoints: imports, customers, merging, translations and smart search

The dashboard's own endpoints for M13 (signed-in session, same-origin requests only; not part of the versioned API, and they may change). Every id in the path is checked against the project in the path. JSON bodies are read with a size cap (`413` past it).

**Spreadsheets** (IMP-04): **`POST /api/admin/projects/{id}/import-csv/xlsx`** with the .xlsx file as the raw body (at most 20 MB) answers `{ csv, rows, truncated }`: the first sheet as CSV for the column mapper (`POST …/import-csv/preview` and `POST …/import-csv`, unchanged). A pasted table is sent to those as `csv` directly.

**Synced sources** (IMP-02, [guide](IMPORT.md#keeping-a-source-in-sync)):

- **`GET /api/admin/projects/{id}/import-sources`**: `{ sources: [{ id, adapter, label, intervalHours, paused, options, lastRunAt, lastStatus, lastError, failures, alerting, nextRunAt, itemsAdded, running, lastRun, createdAt }] }`.
- **`POST /api/admin/projects/{id}/import-sources`**: `{ runId, intervalHours: 12 | 24 }` keeps a finished import in sync (201). 400 for a file or saved-page import, 409 for the same source twice.
- **`PATCH /api/admin/projects/{id}/import-sources/{sourceId}`**: `{ paused?, intervalHours?, options? }`. **`DELETE`** stops syncing (204). **`POST …/{sourceId}/run`** runs it now (202, `{ runId, source }`; a run already going is left alone).

**Customers** (INBOX-12, [guide](help/customers.md)):

- **`GET /api/admin/projects/{id}/customers?q=&page=`**: 50 a page, with `testimonials`, `feedback` and `invites` counts.
- **`GET /api/admin/projects/{id}/customers/{customerId}`**: the profile: `customer`, `testimonials`, `feedback`, `invites` (with each personal `link`), `rewards` and the project's `forms` (with `asksForVideo`). **`PATCH`** `{ name?, email?, title?, company?, website? }` edits the record only (409 when another customer has that email).
- **`POST …/customers/{customerId}/invite`**: `{ formId: string | null, send: boolean }` creates a personal request (201, `{ request }` with its `link`); 409 when they already have an open one or unsubscribed, 400 without an email address.
- `POST /api/admin/projects/{id}/testimonials/manual` takes `customerId` in its payload to link the new testimonial to that person.

**Duplicates and merging** (INBOX-11): the inbox list takes `dupes=1` (only testimonials with a likely duplicate), and `GET /api/admin/testimonials/{id}/detail` has `duplicates` and `mergedInto`. **`POST /api/admin/projects/{id}/testimonials/merge`** `{ from, into }` copies `from`'s main answer, other answers, highlights, images (owner-only unless `from` was public under the same consent), tags and consent ledger onto `into`, moves `from` to the trash, and sends `testimonial.updated` for `into` and `testimonial.trashed` for `from`. 404 across projects; 409 from or into the trash, after a withdrawal, or while a video is still processing.

**Translations** (INBOX-13, [guide](help/inbox.md#translations)):

- **`GET /api/admin/testimonials/{id}/translations`**: `{ translations, provider }` (`provider` is null when none is set up).
- **`PUT /api/admin/testimonials/{id}/translations/{lang}`** `{ headline?, text? }` adds or edits one by hand; **`DELETE`** removes it. `lang` is lower-case BCP 47 (`fr`, `pt-br`).
- **`POST /api/admin/testimonials/{id}/translations`** `{ lang }` has your provider write it now (201); 409 without a provider, 502 when it fails.
- The bulk endpoint takes `action: "translate"` with `langs: ["fr", …]` (up to 10): one background job per testimonial, keeping translations written by hand.
- The inbox's JSON export adds `translations: [{ lang, headline, text, machine }]` to rows that have some, and the project's zip export carries them.

**Smart search** (INBOX-14, [guide](help/inbox.md#smart-search)): the inbox list takes `smart=1` with `q`. With the `aisearch` flag on and `EMBEDDINGS_MODEL` set, the rows are the best matches by meaning (at most 100, best first) with every other filter applied, and the answer has `search: { mode: "smart" }`. Otherwise it's the usual keyword search with `search: { mode: "keyword", fallback: "off" | "failed" }`.
