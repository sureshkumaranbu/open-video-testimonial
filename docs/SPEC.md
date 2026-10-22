# Plaudit: product spec

**Plaudit** is a free, open-source (MIT), self-hostable app for collecting **video and text testimonials**, moderating them, and showing them on any website.

The behaviour is informed by the clean-room study in [`research/senja-teardown.md`](research/senja-teardown.md). The name, UI, copy and code are original.

## Goals

- **One-command self-hosting.** `docker compose up` and a single volume, with no external services required.
- **The core loop, done well.** Collect, then moderate, then display.
- **No artificial limits.** No caps on testimonial count, widgets or walls, and no forced branding.
- **Privacy by default.**
  - Collector emails are never exposed publicly.
  - Explicit consent is recorded.
  - Widgets load no third-party trackers.
- **Embeds that can't break the host site or be broken by it.** The script embed uses Shadow DOM; the iframe option resizes itself.

## Non-goals (for now)

- Multi-tenant SaaS hosting, billing or teams.
- Scraping third-party review sites in ways their terms forbid.

---

## Concepts

| Concept | Description |
|---|---|
| **Owner** | The person running the instance. Signs into the dashboard. |
| **Project** | One product or brand. Has a URL slug, a name, the question shown to customers, a thank-you message, an accent colour, and whether text and/or video are accepted. |
| **Testimonial** | Belongs to a project. Has a status (`pending` → `approved` / `rejected`), an optional 1–5 rating, optional text, an optional video, and author name, email (private), role/title, company and avatar. Also records a consent timestamp, a source (`form` for now) and timestamps. |
| **Tag** | A free-form label per project. A testimonial can have many. Used to filter walls and widgets. |

## Surfaces

| Surface | URL | Who |
|---|---|---|
| Collection page | `/c/<slug>` | Customers (public) |
| Wall of love | `/wall/<slug>?theme=light\|dark&tag=…` | Public |
| Iframe embed | `/embed/<slug>?theme=…&tag=…&limit=…` | Public, framed by other sites |
| Script embed | `/widget.js` and `/api/widget/<slug>` | Public, any origin (CORS `*`) |
| Media | `/api/media/<videos\|images>/<uuid>.<ext>` | Public, unguessable keys, Range support |
| Dashboard | `/admin`, `/admin/projects/<id>` | Owner (session cookie) |
| Admin API | `/api/admin/*` | Owner (session cookie, same-origin) |

---

## MVP scope (this release)

### 1. Collection page

- Shows the project name and question, a 1–5 star rating, and a **Write / Video** switch (the switch only appears if the project accepts both).
- **Text**: a textarea of up to 5,000 characters.
- **Video**:
  - Record in the browser with `getUserMedia` and `MediaRecorder`. The recorder prefers VP9/VP8 WebM and falls back to MP4. Recordings are capped at 2 minutes, with preview and re-record.
  - Or upload a file (WebM, MP4, MOV or Ogg).
- **Author fields**: name (required), email (optional, private), role/title, company, and a photo (PNG, JPEG, WebP or GIF).
- **Consent**: a required checkbox. The server stores `consent_at`.
- **Spam protection**: a honeypot field and a per-IP rate limit (10 submissions per 10 minutes).
- **Upload checks**: the server checks the real file type from its **magic bytes**, not from what the client claims. Size limits are configurable (`MAX_VIDEO_MB`, default 200; `MAX_IMAGE_MB`, default 5). SVG is never accepted.
- New testimonials always start as **pending**.

### 2. Dashboard

- **Sign-in**: a single owner, whose credentials come from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
  - The session cookie is HMAC-signed, `HttpOnly` and `SameSite=Lax`, and expires after 7 days. It is `Secure` when `COOKIE_SECURE=true`.
  - Login attempts are rate-limited.
  - Mutating requests are checked against the Origin header (CSRF defence).
- **Projects**: list them with pending and approved counts, and create new ones (name and slug).
- **Project page**:
  - Filter testimonials by Pending / Approved / Rejected / All.
  - Per testimonial: approve, reject, move back to pending, delete (which also removes its media), edit the display name, and set tags.
  - **Share & embed** panel: the collection link, plus copy-paste script and iframe snippets with a light/dark toggle.
  - **Settings**: name, question, thank-you message, accent colour, and which of text/video are allowed.

### 3. Wall of love

- A responsive masonry grid of **approved** testimonials, newest first.
- Each card shows the video player (if any), stars, text, avatar or initial, name and byline.
- Optional `?theme=dark` and `?tag=`.

### 4. Embeds

- **Script**: `<script src=".../widget.js" data-project="slug" async>`.
  - Renders into a **Shadow DOM** root right after the script tag, or into `data-target`.
  - Options: `data-theme="light|dark|auto"`, `data-layout="grid|list"`, `data-tag`, `data-limit`.
  - All user content is inserted with `textContent`, never as HTML.
  - Media URLs resolve against the script's own origin.
- **Iframe**: `/embed/<slug>` renders the same grid on a transparent background and posts `{type: "plaudit:resize", slug, height}` to the parent. The snippet includes a three-line listener that sizes the iframe.
- **JSON feed**: `GET /api/widget/<slug>` returns `{project:{name, slug, accentColor}, testimonials:[{id, name, title, company, avatarUrl, rating, text, video:{url, mime}|null, tags, createdAt}]}`.
  - The feed is an explicit allow-list, so emails and internal fields can't leak.
  - Cached publicly for 60 seconds.

### 5. Self-hosting

- Next.js 16 (App Router), TypeScript, SQLite (better-sqlite3) through the Drizzle ORM. SQL migrations are committed in `drizzle/` and applied automatically on start.
- Media is stored on local disk under `DATA_DIR/uploads` and streamed with HTTP Range support.
- A multi-stage Dockerfile builds the standalone Next output, which runs as a non-root user with a healthcheck. `docker-compose.yml` mounts one named volume at `/data`.
- Configuration lives in `.env` (see `.env.example`).

### 6. Quality

- **Vitest** integration tests call the real route handlers against a temporary SQLite database. They cover:
  - submission: validation, uploads, file-type sniffing, honeypot, rate limit
  - moderation and auth: session, tampering, CSRF, approve/reject, rename, tags, delete
  - the widget feed: approved-only, no private fields, tag filter, limit, CORS
  - media range requests and path traversal
- **Playwright** end-to-end tests run against the production build, and against the Docker image in CI. They cover:
  - text and upload submissions, and recording with Chromium's fake camera
  - admin moderation
  - the wall (videos actually play)
  - both embed types on a page from another origin, in light and dark themes
- GitHub Actions runs typecheck, unit tests and E2E tests, plus a separate Docker Compose E2E job.

---

## Later (prioritised)

**P1: makes it a serious alternative**

1. **Video processing pipeline.**
   - An ffmpeg worker that transcodes to MP4 (H.264/AAC), which fixes Safari playback of WebM and adds real duration metadata to MediaRecorder output.
   - Poster thumbnails.
   - Optional HLS.
   - Size and length enforcement after transcoding.
2. **S3-compatible storage driver** (AWS S3, Cloudflare R2, MinIO). Uploads go direct-to-bucket with presigned URLs to avoid proxying large videos.
3. **Postgres option.** The Drizzle schema is portable; add a `DATABASE_URL` switch and a pg migration set.
4. **More widget layouts**: carousel, auto-scrolling marquee, single testimonial, rating badge (average and count), and a popup/toast. Add per-widget saved configurations so snippets don't need many data attributes.
5. **Email requests.** SMTP settings, an "invite customers" form (CSV or paste), a branded request email, and one reminder. Also a new-testimonial notification to the owner.
6. **REST API with tokens** (list, get, create/import, update status and tags, delete) and **HMAC-signed webhooks** (`testimonial.created`, `.approved`, `.updated`, `.deleted`). This makes Zapier, n8n and Activepieces integrations possible.
7. **Manual and CSV import.** Add a testimonial by hand, or bulk-import rows of name, rating, text and source URL.
8. **SEO**: JSON-LD `Review` / `AggregateRating` on the wall page, and optionally emitted by the widget.

**P2**

- Ordering (drag-and-drop or pin) on walls and widgets, and "featured" flags.
- Form customisation: custom questions and fields, required toggles, logo upload, prefill from query string (`?name=&email=`), multiple forms per project, and granular consent options.
- Speech-to-text transcripts (pluggable: local Whisper or an API) and captions on playback.
- Multiple users, invitations and roles. OAuth/OIDC sign-in.
- Custom domains per project (documented reverse-proxy recipes).
- Public single-testimonial pages and share images (OG cards).
- Localisation of the collection page.
- Privacy-friendly view counts (no cookies, aggregated).
- Importers that use official APIs or exports where terms allow (Google Business, Trustpilot, Product Hunt, App Store).

## Known limitations of the MVP

- **Media access**: files are served by unguessable UUID URLs, but are not access-controlled, so a pending video is reachable by anyone who has its URL. Moving to per-request signed URLs for non-approved items is planned.
- **WebM playback**: in-browser recordings are stored as recorded (usually WebM). Very old Safari versions can't play WebM until the transcoding pipeline exists. Chrome's WebM recordings also carry no duration header, so players show no total time.
- **Single instance**: the rate limiter is in-memory, so one instance is assumed.
- **Single owner**: there are no teams.
