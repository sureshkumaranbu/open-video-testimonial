# REST API and webhooks

Plaudit has a small REST API and signed webhooks, so you can connect it to n8n, Zapier, Make, Activepieces or your own scripts. Both are free and have no plan limits.

- [REST API](#rest-api)
- [Webhooks](#webhooks)
- [Verifying webhook signatures](#verifying-webhook-signatures)
- [Connecting n8n](#connecting-n8n)

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
| `GET /projects` | read | Lists projects with their counts per status |
| `GET /projects/{slug}/testimonials` | read | Lists testimonials, newest first. Query: `status` (`pending`, `approved`, `rejected`), `tag`, `limit` (1 to 100, default 50), `offset` |
| `POST /projects/{slug}/testimonials` | write | Adds a text testimonial (see below) |
| `GET /testimonials/{id}` | read | Gets one testimonial |
| `PATCH /testimonials/{id}` | write | Changes `status`, `tags`, `authorName`, `authorTitle`, `authorCompany`, `text`, `rating`, `transcript` or `captionsVtt` |
| `DELETE /testimonials/{id}` | write | Deletes a testimonial and its media |

Errors look like `{ "error": "…" }`, with status `400` (invalid input), `401` (missing or bad key), `403` (read-only key), `404`, `409` (for example, re-publishing a testimonial whose author withdrew consent) or `429`.

### A testimonial

```json
{
  "id": "5b0d…",
  "projectId": "9e1f…",
  "status": "approved",
  "rating": 5,
  "text": "We set it up on Friday and had six videos by Monday.",
  "transcript": "Hi, I'm Ada…",
  "author": { "name": "Ada Lovelace", "email": "ada@example.com", "title": "CTO", "company": "Engines Ltd", "avatarUrl": null },
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
  "requested": true,
  "consent": { "at": "2026-10-22T09:30:00.000Z", "scopes": ["website", "social"], "editedAfterConsent": false, "withdrawnAt": null },
  "createdAt": "2026-10-22T09:30:00.000Z",
  "updatedAt": "2026-10-22T10:02:11.000Z"
}
```

Unlike the public widget feed, API responses include **private fields** (the author's email and the consent details), because they go to your own systems. Treat API keys like passwords.

### Adding a testimonial

```bash
curl -X POST https://plaudit.example.com/api/v1/projects/acme/testimonials \
  -H "Authorization: Bearer plk_…" -H "Content-Type: application/json" \
  -d '{"name":"Grace Hopper","text":"Shipped it in a day.","rating":5,"tags":["sales"],"consent":true}'
```

`consent: true` is required. It confirms that the person agreed to publication, and it's recorded in the consent ledger as given via the API. Optional fields are `email`, `title`, `company`, `status` (`pending` or `approved`) and `consentScopes` (`["website","social"]`).

## Webhooks

Under **Settings → Webhooks**, add the URL of your endpoint. You can limit it to one project and to the events you care about; tick none to receive all of them.

| Event | When |
|---|---|
| `testimonial.created` | Someone submits a testimonial (or one is added through the API) |
| `testimonial.approved` | A testimonial is approved |
| `testimonial.rejected` | A testimonial is rejected |
| `testimonial.deleted` | A testimonial is deleted (the payload is the last state) |
| `testimonial.transcribed` | A video's transcript and captions are ready |
| `consent.withdrawn` | The author withdrew consent through their private link |
| `ping` | You pressed **Send test event** |

Imports (CSV or archive) don't send webhooks.

Each delivery is a `POST` with a JSON body:

```json
{
  "id": "d1c3…",
  "event": "testimonial.approved",
  "createdAt": "2026-10-22T10:02:11.000Z",
  "project": { "id": "9e1f…", "slug": "acme", "name": "Acme", "collectUrl": "…", "wallUrl": "…", "createdAt": "…" },
  "data": { "testimonial": { "…": "same shape as the REST API" } }
}
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
