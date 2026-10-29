# Plaudit

Plaudit is a free, open-source and self-hostable app for collecting **video and text testimonials**. Customers record a video or write a few lines on a hosted page. You approve the best ones, and they appear on your site through a single embed snippet.

There are no testimonial caps, no per-email or per-minute fees, no forced branding and no third-party trackers. Your data stays on your server, and you can export all of it in one click. MIT licensed.

| Home page (desktop) | Home page (mobile) |
|---|---|
| ![Home page on desktop](docs/screenshots/home-desktop.png) | ![Home page on mobile](docs/screenshots/home-mobile.png) |

| Collection page | Admin dashboard |
|---|---|
| ![Collection page](docs/screenshots/collection-page.png) | ![Admin dashboard](docs/screenshots/admin-dashboard.png) |

| Recording on a phone (questions on screen) | Requests and reminders |
|---|---|
| ![Recorder on a phone](docs/screenshots/recorder-mobile.png) | ![Requests screen](docs/screenshots/requests.png) |

| Wall of love | Embedded widget (dark theme, on another site) |
|---|---|
| ![Wall of love](docs/screenshots/wall-of-love.png) | ![Embedded widget](docs/screenshots/embed-script-dark.png) |

More: [settings (API keys and webhooks)](docs/screenshots/settings.png) · [import and export](docs/screenshots/import-export.png) · [full home page](docs/screenshots/home-full.png)

## Contents

- [Features](#features)
- [Quick start with Docker](#quick-start-with-docker)
- [Quick start with Node.js](#quick-start-with-nodejs)
- [First steps](#first-steps)
- [Configuration](#configuration)
- [Optional features](#optional-features): [sign-in and team](#sign-in-and-team) · [video conversion](#video-conversion-ffmpeg) · [media storage (S3)](#media-storage-s3) · [email](#email-requests-reminders-and-receipts) · [transcripts](#transcripts-and-captions) · [API and webhooks](#api-and-webhooks) · [turning sections off](#turning-sections-off)
- [Embedding](#embedding)
- [Backups, moving and upgrading](#backups-moving-and-upgrading)
- [Privacy and consent](#privacy-and-consent)
- [Troubleshooting](#troubleshooting)
- [Development and tests](#development-and-tests)
- [Project docs](#project-docs)

## Features

**Collecting**

- **Forms**: several step-by-step forms per project from 8 templates, with up to 10 questions, custom and hidden fields, 11 languages, design and per-form rules, plus QR codes and embeds. See [`docs/help/forms.md`](docs/help/forms.md).
- A collection page per project at `/c/<slug>`: star rating, a written testimonial **or a video**, name, private email, role, company, photo, and consent.
- **A recorder that works on phones.**
  - It records MP4 on Safari and iOS, and WebM elsewhere.
  - There's a 3-2-1 countdown, and your questions stay on screen while people talk.
  - On phones the stage is upright, and people can switch cameras.
  - Recording stops cleanly at a time limit you choose.
  - People can also use their phone's camera app, or upload a file.
- **Uploads that survive bad connections.** Video uploads in small pieces while it records and resumes after a dropped connection. Big files never need a big request.
- **Personal request links.** Paste a list or load a CSV. Each person gets a link that fills in their details. Invitations and reminders go out through your own email server, reminders stop when they reply, and there's one-click unsubscribe.

**Managing**

- An **inbox** with search, filters, sort and pages that you can share by link, bulk actions, a trash, a detail drawer with the full editor, highlights and history, and adding testimonials by hand. See [`docs/help/inbox.md`](docs/help/inbox.md).
- **Importers** for Google, Trustpilot, G2, Capterra, Product Hunt, the App Store, Google Play and X, and moves from Testimonial.to, Senja and Shapo; 22 more sources (YouTube, Reddit, WooCommerce, Etsy, WordPress.org, Apple Podcasts, Feefo, Shopify review apps and others, some from a page you save); **auto-sync** every 12 or 24 hours; and Excel files or a table pasted from a spreadsheet. See [`docs/IMPORT.md`](docs/IMPORT.md).
- **Customers, duplicates and merge**: one record per person with everything they sent and were sent, and possible duplicates you can merge without losing either answer. **Translations** by hand or with your own provider, shown to visitors in their language, and **smart search** by meaning with your own AI provider. See [`docs/help/customers.md`](docs/help/customers.md) and [`docs/help/inbox.md`](docs/help/inbox.md).
- **Optional auto-approve**, set for each project and off by default. New testimonials with enough stars (4+ or 5) and no links go live without a click. Videos are included only if you say so, once they've been processed. Anything else waits in *Pending*, and you can reject an approved one at any time.
- **Video conversion.** With ffmpeg, every video becomes a fast-start MP4 that plays in every browser, plus a poster image. The original is kept.
- **Transcripts and captions.** Use a local speech-to-text program (such as whisper.cpp, so no audio leaves your server) or any OpenAI-compatible API. You can edit both, and "use transcript as quote" turns one into the written text.
- **Consent ledger.** Your consent wording is versioned. Each testimonial records what was agreed to (website, plus optional social media), when, and with which wording. Edits you make afterwards are logged, and authors get a private link to withdraw.

**Showing**

- A wall of love at `/wall/<slug>`, light or dark, and as many walls as you like with an editor, themes, tag tabs, a call to action and SEO (JSON-LD, link preview images). See [`docs/help/walls.md`](docs/help/walls.md).
- **Widget studio**: saved widgets in 9 layouts with a live preview and script, iframe, hosted link, React and server-side HTML embeds. See [`docs/help/widgets.md`](docs/help/widgets.md).
- **Embeds**: one `<script>` tag that renders into Shadow DOM, so your site's CSS can't break it, or an auto-resizing `<iframe>`. Light, dark or auto theme, grid or list, and filter by tag. Videos show posters, play in their own shape, and have captions on by default.

- **Sales popup and "Verified purchase"** (flag `commerce`): connect a project to Stripe and show recent purchases in a small corner popup on your site ("Priya from Leeds bought Pro plan · 2 hours ago"), optionally between approved testimonials. Only the first name, a city or country, the product and the amount are kept, for 90 days; never the email, surname, address or card. Testimonials from buyers are marked **Verified purchase** (matched on a hash of the email). See [`docs/help/sales-popup.md`](docs/help/sales-popup.md).
- **Thank-you coupons** (`commerce`): a form reward that gives each person their own single-use Stripe promotion code, made with a restricted key that can only write promotion codes. See [`docs/help/thank-you-coupons.md`](docs/help/thank-you-coupons.md).
- **Social post drafts** (`commerce`): each approved testimonial gets a post for X and LinkedIn in the customer's own words, with share links, copy, and Rewrite with AI; the `testimonial.approved` webhook carries it for Buffer or Typefully through Zapier, Make and n8n. Plaudit never posts for you. See [`docs/help/social-drafts.md`](docs/help/social-drafts.md).
- **Browser extension** for Chrome and Firefox: save a selection, or an X or LinkedIn post with its author, to the inbox as Pending, through your own API key. See [`docs/help/extension.md`](docs/help/extension.md).

**Understanding**

- **Insights** (flag `insights`): Voice of Customer over any period and tag (the rating and sentiment breakdown, the phrases customers share, what they love and what to improve), **ask a question** of your testimonials, an **NPS** dashboard, and saved reports as CSV. **NPS questions and surveys** where only promoters who say yes go on to write a testimonial. **Case studies** from a testimonial, with a public page and a PDF. **Screenshot reading** (OCR) for praise that arrives as an image. All of it works without AI; with your own provider (`AI_MODEL`), buttons draft case studies and surveys, find themes and answer questions, and only what you ask about is sent. See [`docs/help/insights.md`](docs/help/insights.md).

**Getting started**

- **A setup guide** at `/admin/welcome`: name your project, give your website and say what you sell. Plaudit reads your home page for your logo, brand colour and any testimonials already on it (schema.org reviews and quote blocks with a name), imports the ones you pick as approved, and makes a step-by-step form, a Wall of Love and two widgets in your colours. A **Get started** checklist on the project follows what's left.
- **Empty states** on every list with the one thing to do next.

**Notifications**

- **Email for each person on the team**: every new testimonial or a daily digest, a weekly reminder of what's waiting, a summary when an import finishes, and a monthly report. All off until you turn them on, and only ever sent to people who have signed in.
- **Slack, Discord, Microsoft Teams and Telegram**: the stars, the quote and a link that opens it ready to approve. Each form can choose its channels, and a Test button checks the connection.

**Connecting**

- **REST API** with read-only or read-write keys (for every project or one), and an OpenAPI 3.1 description: testimonials, invites, and (flag `api2`) forms, widgets, walls, campaigns, tags, customers, feedback, analytics and webhook subscriptions.
- **Signed webhooks** for n8n, Zapier, Make and Activepieces, with retries and a delivery log; tools can subscribe themselves through the API (Zapier's instant triggers).
- **Stripe and Shopify triggers** for campaigns: a signed paid checkout, invoice or fulfilled order invites the buyer, days later if you like ([`docs/help/campaigns.md`](docs/help/campaigns.md#stripe-and-shopify)).
- **An MCP server** at `/mcp` (flag `mcp`), so Claude and other AI assistants can find quotes, give embed codes, summarize and send invites with an API key ([`docs/help/mcp.md`](docs/help/mcp.md)).
- **Integrations** in [`integrations/`](integrations/README.md): a WordPress plugin (block, shortcodes, SEO mode, site-wide toast), a Zapier app, n8n and Make templates; and React components in [`packages/react/`](packages/react/README.md). Not in their marketplaces yet.
- **Import and export.** One .zip holds everything (data, consent history and media) and can be imported on any Plaudit server. There's also CSV import with a column mapper, for spreadsheets and exports from other testimonial tools.

**Running**

- SQLite plus local disk, one Docker volume, and `docker compose up`.
- No telemetry and no outside calls, except the ones you configure: your SMTP server, your transcription, translation, embeddings and AI services, your webhooks, review sites you import from, and media URLs in CSVs you import.

## Quick start with Docker

You need Docker with the Compose plugin.

```bash
git clone https://github.com/sureshkumaranbu/open-video-testimonial.git plaudit
cd plaudit
cp .env.example .env
```

Open `.env` and set at least:

- `ADMIN_EMAIL` and `ADMIN_PASSWORD`: your sign-in as the owner. You can add Google, Apple, email links and teammates later ([guide](docs/AUTH.md)).
- `SESSION_SECRET`: a long random string. `openssl rand -hex 32` makes one.
- `PUBLIC_URL`: the address people will use, such as `http://localhost:3000` on your own computer.

Then start it:

```bash
docker compose up -d --build
```

Open <http://localhost:3000/admin> and sign in. The image includes ffmpeg, so video conversion works out of the box.

Everything (the SQLite database and uploaded media) lives in the `plaudit-data` Docker volume, mounted at `/data`.

> **Before you put it on the internet**
> - Use a strong `ADMIN_PASSWORD` and a random `SESSION_SECRET`.
> - Serve it over HTTPS behind a reverse proxy (Caddy, Traefik, nginx…).
> - Set `PUBLIC_URL=https://your-domain` and `COOKIE_SECURE=true`.
> - Set `TRUST_PROXY=true` so rate limits see each visitor's real address. Only do this when a proxy sits in front: without one, anyone could fake the header it trusts.
> - Uploads arrive in 8 MB pieces, so the default request-size limits of most proxies are fine. If you raise `MAX_VIDEO_MB`, nothing else needs changing.

## Quick start with Node.js

You need **Node.js 22.12 or newer**. **ffmpeg** is optional but recommended, for video conversion and transcripts:

- macOS: `brew install ffmpeg`
- Debian/Ubuntu: `sudo apt install ffmpeg`
- Windows: `winget install ffmpeg`

```bash
git clone https://github.com/sureshkumaranbu/open-video-testimonial.git plaudit
cd plaudit
npm ci
cp .env.example .env   # set ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET
npm run build
npm start              # http://localhost:3000
```

For development with hot reload, run `npm run dev` instead of build and start. Data goes to `./data` unless you set `DATA_DIR`.

## First steps

1. **Create a project** on the admin home page. A project is one product or brand, with its own link.
2. **Adjust the collection page** in the project's settings: the question, the prompts shown while recording, the longest video, your brand colour, and the consent wording.
3. **Share the link** `/c/<slug>`. You can paste it anywhere, or use **Requests** to send personal links by email.
4. **Review.** New testimonials wait in *Pending*. Approve the ones you want to show, or let [auto-approve](#auto-approve) do it for the good ones.
5. **Embed.** Copy the snippet from the **Share & embed** panel into your site.

### Auto-approve

By default, every testimonial waits for you to press **Approve**. To skip that for the good ones, open the project and use the **Auto-approve** panel:

- **Approve new testimonials automatically**: off by default.
- **Minimum rating**: 4 stars (4 or 5) or 5 stars.
- **Include video testimonials**: off by default. Videos are harder to check at a glance, so they're a separate choice. A video is approved only once it has been processed (this needs ffmpeg). One that is still processing, or couldn't be processed, waits for you.

A testimonial is approved automatically only if **all** of these are true:

- It came from your collection page or a personal request link. CSV imports, the API and project imports keep their own status.
- It has a star rating of at least the minimum. No rating means it waits.
- Its text has no links (`http://`, `https://` or `www.`), so spam can't go live by itself.
- Its author hasn't withdrawn it.

Turning auto-approve on doesn't approve what is already waiting. It applies only to testimonials sent from then on.

An auto-approved testimonial behaves exactly like one you approved: it appears on the wall, in the widget and iframe, and in the JSON feed, and `testimonial.approved` webhooks fire (with `"approvedBy": "auto"`). In the dashboard it carries an **Auto-approved** label and the line "Approved automatically (4+ stars)". Reject it like any other, and it comes straight off your site.

## Configuration

Every setting is an environment variable, read from `.env` (Node) or `docker-compose.yml` / `.env` (Docker). `.env.example` lists and explains all of them.

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | none (required) | The owner's address and password for the dashboard |
| `ADMIN_EMAILS`, `ALLOWED_EMAIL_DOMAINS` | unset | More people who may sign in as admins: a comma-separated list of addresses, and of domains ([sign-in guide](docs/AUTH.md#who-can-sign-in)) |
| `PASSWORD_LOGIN` | `true` | `false` turns off password sign-in once another method works |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_HOSTED_DOMAIN` | unset | Sign in with Google ([setup](docs/AUTH.md#google)) |
| `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (or `APPLE_PRIVATE_KEY_FILE`) | unset | Sign in with Apple ([setup](docs/AUTH.md#apple)) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | unset | Single sign-on with any OpenID Connect provider (Okta, Microsoft Entra ID, Authentik, Keycloak…), found through its discovery document ([setup](docs/AUTH.md#single-sign-on-oidc)) |
| `OIDC_LABEL`, `OIDC_SCOPES` | `single sign-on`, `openid email profile` | The button's name ("Continue with …") and the scopes asked for |
| `OIDC_EMAIL_DOMAINS` | unset | Only accept addresses at these domains from the OIDC provider (comma-separated). It lets no one in by itself |
| `OIDC_TRUST_EMAIL` | `false` | `true` accepts addresses the provider doesn't mark `email_verified` (Entra ID leaves the claim out). Only for a provider whose addresses you control |
| `SESSION_SECRET` | none (required) | Signs session cookies and personal links. At least 16 characters. Changing it signs everyone out and invalidates old request links |
| `PUBLIC_URL` | `http://localhost:3000` | Used in links, emails, embed snippets and the API |
| `DATA_DIR` | `./data` (`/data` in Docker) | The SQLite database, uploads and temporary files |
| `MAX_VIDEO_MB`, `MAX_IMAGE_MB` | `200`, `5` | Upload limits |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS |
| `TRUST_PROXY` | `false` | Set `true` (or the number of proxies) when a reverse proxy in front adds the client's address to `X-Forwarded-For`. Rate limits then use that address instead of the proxy's. Leave it off when Plaudit is reached directly |
| `MEDIA_PROCESSING` | on | `off` serves videos exactly as uploaded |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe` | Where to find ffmpeg if it's not on `PATH` |
| `VIDEO_HLS` | `false` | `true` also makes an adaptive-streaming (HLS) copy of every approved video: two or three renditions up to 720p, which players offer first so Safari streams them; other browsers keep the MP4. It costs CPU and roughly doubles the storage of approved videos ([details](docs/help/video.md#streaming-hls)) |
| `SMTP_URL`, `SMTP_FROM` | unset | Your mail server and sender, for requests, reminders and receipts ([set up email](docs/EMAIL.md)). Without `SMTP_FROM`, mail comes from `no-reply@localhost`, which real servers refuse |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` | unset | The mail server in parts instead of `SMTP_URL`, so the password needn't be URL-encoded. `SMTP_URL` wins if both are set |
| `MAIL_OUTBOX` | `false` | `true` writes emails to `DATA_DIR/mail-outbox` instead of sending them (for trying things out) |
| `TRANSCRIBE_PROVIDER` | `off` | `command` or `openai` ([details](#transcripts-and-captions)) |
| `TRANSCRIBE_COMMAND` | unset | For `command`: the program to run |
| `TRANSCRIBE_API_URL`, `TRANSCRIBE_API_KEY`, `TRANSCRIBE_MODEL`, `TRANSCRIBE_LANGUAGE` | OpenAI defaults | For `openai` |
| `CONSENT_IP_HASH` | `false` | `true` stores a keyed hash of the submitter's IP with each consent record |
| `MAX_IMPORT_MB` | `10240` | Largest export archive accepted for import |
| `IMPORT_ALLOW_PRIVATE_URLS` | `false` | Lets CSV imports download media from private-network addresses |
| `JOBS_WORKER`, `JOBS_POLL_MS` | on, `2000` | The background worker (video conversion, email, webhooks) runs inside the server process |
| `STORAGE_DRIVER` | `local` | Where videos and photos are kept: `local` (`DATA_DIR/uploads`) or `s3`, any S3-compatible bucket ([media storage](#media-storage-s3)) |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | unset | For `s3`: the bucket, and a key that can read, write and delete in it |
| `S3_ENDPOINT`, `S3_REGION` | AWS, `us-east-1` | For `s3`: the service's address, such as `https://<account>.r2.cloudflarestorage.com` or `http://localhost:9000`. Leave the endpoint empty for AWS in `S3_REGION`. Cloudflare R2 uses the region `auto` |
| `S3_FORCE_PATH_STYLE` | `false` | `true` puts the bucket in the path (`https://host/bucket/…`) instead of the host name. MinIO usually needs it |
| `S3_PREFIX` | none | A folder inside the bucket for Plaudit's files, such as `plaudit` |
| `S3_DIRECT_UPLOADS` | `false` | For `s3`: `true` lets browsers send videos straight to the bucket through short-lived presigned URLs instead of through Plaudit. Needs the bucket's CORS set up ([direct uploads](#direct-uploads-to-the-bucket)) |
| `TRASH_RETENTION_DAYS` | `30` | Days a testimonial stays in the trash before it's deleted for good |
| `PLAUDIT_FEATURES` | `all` | Which [sections](#turning-sections-off) the dashboard shows: `all`, `none`, or a comma-separated list of `forms`, `inbox2`, `widgets`, `walls`, `importers`, `notifications`, `onboarding`, `campaigns`, `booster`, `analytics`, `share`, `imports2`, `customers`, `translations`, `aisearch`, `api2`, `mcp`, `team2`, `video2`, `insights` and `commerce` |
| `AUDIT_RETENTION_DAYS` | `365` | Days the audit log keeps an entry ([team and audit log](docs/help/team.md)) |
| `ANALYTICS` | on | `off` stops all analytics: nothing is collected or stored, and the analytics pages are hidden. Cookieless either way ([what's collected](docs/help/analytics.md)) |
| `DIGEST_HOUR_UTC` | `8` | The hour (UTC, 0 to 23) when daily digests, the Monday reminder and the monthly report go out ([notifications](docs/help/notifications.md)) |
| `GOOGLE_PLACES_API_KEY` | unset | Your own Google Cloud key with **Places API (New)** enabled, for the Google review importer (see [docs/IMPORT.md](docs/IMPORT.md)) and the review booster's business search ([docs/help/booster.md](docs/help/booster.md)); called from the server only |
| `PRODUCT_HUNT_TOKEN` | unset | Your own Product Hunt API (v2) developer token, for reading a launch's comments; without it the Product Hunt importer reads the public page |
| `YOUTUBE_API_KEY` | unset | Your own YouTube Data API v3 key, for importing the comments on your videos; without it each video link imports as a testimonial that links to it ([docs/IMPORT.md](docs/IMPORT.md)) |
| `ETSY_API_KEY` | unset | Your own Etsy Open API v3 key (keystring), for importing your shop's reviews |
| `TRANSLATE_PROVIDER` | `off` | Machine translation with your own provider: `deepl`, `libretranslate` or `openai` (any OpenAI-compatible `/chat/completions` endpoint). Testimonial text is sent to it only when you ask for a translation, a form translates on arrival, or you use bulk Translate ([docs/help/inbox.md](docs/help/inbox.md#translations)) |
| `TRANSLATE_API_URL`, `TRANSLATE_API_KEY`, `TRANSLATE_MODEL` | DeepL Free / OpenAI addresses | The provider's address (required for LibreTranslate), your key (required for DeepL), and the model (required for `openai`) |
| `EMBEDDINGS_MODEL`, `EMBEDDINGS_API_URL`, `EMBEDDINGS_API_KEY` | unset, OpenAI's address | Smart search with your own OpenAI-compatible `/embeddings` endpoint; off until a model is set. **When it's on, every testimonial's headline, text, transcript and answers are sent to that provider** ([docs/help/inbox.md](docs/help/inbox.md#smart-search)) |
| `AI_MODEL`, `AI_API_URL`, `AI_API_KEY` | unset, OpenAI's address, unset | Your own OpenAI-compatible `/chat/completions` endpoint for case studies, Voice of Customer themes, written answers to questions, AI surveys and (with `OCR_PROVIDER=ai`) screenshots; off until a model is set, and the key is optional (a local model needs none). **Only what an editor asks about is sent, when they press the button that says so**, and an admin can switch AI off per project ([docs/help/insights.md](docs/help/insights.md#ai)) |
| `STRIPE_API_URL` | `https://api.stripe.com` | Where thank-you coupons are made ([docs/help/thank-you-coupons.md](docs/help/thank-you-coupons.md)), with each project's own restricted key from its Commerce tab. Only change it to point tests at a stand-in |
| `OCR_PROVIDER`, `OCR_COMMAND` | `off`, unset | Reading screenshots of reviews: `command` runs a local program such as `tesseract {input} stdout` (no shell; nothing leaves the server), `ai` sends the image to the `AI_*` provider ([docs/help/insights.md](docs/help/insights.md#reading-screenshots)) |
| `BRAND_AI_MODEL`, `BRAND_AI_API_URL`, `BRAND_AI_API_KEY` | unset, OpenAI's address | An optional AI step for the setup guide's brand scan, with your own OpenAI-compatible `/chat/completions` endpoint; without `BRAND_AI_MODEL` it uses the `AI_*` settings, and it's off when neither has a model. **When it's on, the text of the home page being scanned is sent to that provider**, which may suggest the site name, brand colour and testimonials; only what's really on the page is kept ([docs/help/getting-started.md](docs/help/getting-started.md#what-we-look-for-on-your-site)) |

## Optional features

Each of these is off, or degrades gracefully, until you set it up. **Settings → This server** in the dashboard shows what's on.

### Sign-in and team

The owner signs in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. **[Sign-in and your team](docs/AUTH.md)** shows, step by step, how to add any of these:

- **Email links**: no password, just a link that works once. Needs [email](#email-requests-reminders-and-receipts).
- **Sign in with Google**, including Google Workspace.
- **Sign in with Apple**. This needs a paid Apple Developer membership and an HTTPS domain.
- **Single sign-on** with your company's OpenID Connect provider: Okta, Microsoft Entra ID, Authentik, Keycloak and others.
- **Teammates**: invite them in **Settings → Team**, or let in a list of addresses (`ADMIN_EMAILS`) or a whole domain (`ALLOWED_EMAIL_DOMAINS`). Give each one a role (admin, editor or viewer) and, for editors and viewers, the projects they may open; an audit log records who did what ([`docs/help/team.md`](docs/help/team.md)).

Only the methods you set up appear on the sign-in page. Once one works, `PASSWORD_LOGIN=false` turns off the password.

### Video conversion (ffmpeg)

With ffmpeg available (the Docker image has it), each uploaded video is converted in the background:

- to MP4 (H.264/AAC), at most 1280 px on the long side, with fast start
- a poster image is made
- the duration and size are recorded

Players then use the MP4, which plays everywhere including Safari, with the original as a fallback. Without ffmpeg, the original file is served and the dashboard explains why. Videos uploaded before ffmpeg was installed are converted automatically once it is.

To build a smaller Docker image without ffmpeg, set `INSTALL_FFMPEG=false` in `.env` before building.

### Media storage (S3)

Videos and photos are kept on local disk, in `DATA_DIR/uploads`, unless you choose a bucket. Any S3-compatible service works: AWS S3, Cloudflare R2, Backblaze B2, MinIO and others. For example, in `.env`:

```bash
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # leave empty for AWS
S3_REGION=auto                                          # your AWS region, or auto for R2
S3_BUCKET=plaudit-media
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
```

- The bucket can, and should, stay **private**. Uploads are still received and checked on your server (unless you turn on [direct uploads](#direct-uploads-to-the-bucket)), then stored in the bucket, and every file is streamed back through Plaudit, so who may see what is decided exactly as before.
- The key needs to read, write and delete objects in that bucket, and to check the bucket exists. On AWS that's `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:AbortMultipartUpload` and `s3:ListBucket`. Deleting a testimonial or a project removes its files from the bucket.
- Restart Plaudit after changing these. **Settings → Media storage** shows where media is kept and whether the bucket works.
- **Moving an existing server:** after the restart, files already on local disk are still served from there. The owner can press **Copy local media to S3** in **Settings → Media storage** to copy them into the bucket. It runs in the background, skips files that are already there (so it's safe to run again), and keeps the local copies unless you tick **Delete each file from local disk once it's in the bucket**.
- **Going back to local disk:** copy the objects back into `DATA_DIR/uploads` first, keeping their paths (`videos/…` and `images/…`, without `S3_PREFIX`), for example with `aws s3 sync s3://<bucket>/<prefix> ./data/uploads` or `mc mirror`. Then set `STORAGE_DRIVER=local` and restart.

To try it locally, [`docker-compose.s3.yml`](docker-compose.s3.yml) runs MinIO next to Plaudit; the file explains how.

#### Direct uploads to the bucket

By default every upload passes through your server on its way to the bucket. With `S3_DIRECT_UPLOADS=true` (and `STORAGE_DRIVER=s3`), videos go from the visitor's browser straight to the bucket instead, which saves your server's bandwidth on large recordings. Photos and imports still go through the server. Plaudit stays in charge:

- The browser can only write the one object Plaudit chose for that upload (`tmp/<id>` under `S3_PREFIX`), one 8 MB part at a time, each through a URL that's valid for ten minutes and only for that part's exact size and type, up to `MAX_VIDEO_MB`.
- When the last part is in, Plaudit checks the file's real size and first bytes. Anything that isn't a video is deleted; a video is copied to its usual `videos/…` key and goes through conversion and transcripts as before. Abandoned uploads are removed from the bucket after 24 hours.
- Your collection pages (and the dashboard) are then allowed to connect to the bucket's address, and only to that one. That's your own storage, so visitors still talk to no one but you; with the setting off, nothing about the pages changes.
- If the bucket refuses the browser, usually because its CORS isn't set up, the upload carries on through your server automatically.

The bucket must allow `PUT` from your `PUBLIC_URL`. For example, on AWS S3 (Permissions → Cross-origin resource sharing) or Cloudflare R2 (Settings → CORS policy):

```json
[
  {
    "AllowedOrigins": ["https://testimonials.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

Use your own `PUBLIC_URL` as the origin, without a trailing slash. On AWS the key also needs `s3:ListMultipartUploadParts`. Optionally, a lifecycle rule that aborts incomplete multipart uploads and expires `tmp/` after a day or two cleans up after a server that was stopped mid-upload.

### Email (requests, reminders and receipts)

Plaudit sends plain-text email through **your own SMTP server**: your email provider, a transactional mail service, or your own server. That means no per-email cost and mail from your own domain.

**[Set up email](docs/EMAIL.md)** walks through it step by step, with exact settings for Gmail, Microsoft 365, Zoho, Hostinger, cPanel, Resend, Postmark, SendGrid, Mailgun, Amazon SES and Brevo, plus deliverability and troubleshooting. In short:

```bash
SMTP_URL=smtps://user:password@smtp.example.com:465   # TLS (port 465)
# or: smtp://user:password@smtp.example.com:587       # STARTTLS (port 587)
SMTP_FROM="Acme <hello@acme.example>"                 # an address your provider lets you send as
```

URL-encode special characters in the username or password (`@` becomes `%40`), or use `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` and `SMTP_PASSWORD` instead. Restart Plaudit after changing these, then press **Send test email** in **Settings → This server**.

With email set up:

- **Requests** sends invitations, with reminders after the days you choose (default 3 and 7).
- Every email has an unsubscribe link and one-click unsubscribe headers.
- People who respond to a request get a **receipt** with their private withdrawal link, sent to the address you invited. You can turn this off per project. The open collection page never sends email, so it can't be used to send mail from your server to arbitrary addresses.

Without email, Requests still makes personal links for you to send yourself.

To see emails without sending them, set `MAIL_OUTBOX=true`. Each message is written as an `.eml` file in `DATA_DIR/mail-outbox`, which any mail app can open.

### Transcripts and captions

Speech-to-text is off by default. Once a provider is set, each video is transcribed after conversion (ffmpeg is required). The result is shown as captions on every player and as a readable transcript, and you can edit both in the dashboard. You can also type a transcript or paste captions (WebVTT or SRT) by hand, with no provider at all.

**Option A: a local program, with no audio leaving your server.** [whisper.cpp](https://github.com/ggml-org/whisper.cpp) is a good choice:

```bash
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
cmake -B build && cmake --build build -j --config Release
sh ./models/download-ggml-model.sh base.en      # about 150 MB; other sizes and languages are listed there
```

Then, in `.env`:

```bash
TRANSCRIBE_PROVIDER=command
TRANSCRIBE_COMMAND="/path/to/whisper.cpp/build/bin/whisper-cli -m /path/to/whisper.cpp/models/ggml-base.en.bin -f {input} -ovtt -of {output} -np"
```

- Plaudit replaces `{input}` with a 16 kHz mono WAV file and `{output}` with a path. The program must write `{output}.vtt`.
- The command is run directly, never through a shell.
- With Docker, the program and model must be inside the container: mount them as a volume, or build your own image.

**Option B: an OpenAI-compatible API.** This works with OpenAI itself (the audio is then sent to OpenAI) or with a self-hosted server that speaks the same API:

```bash
TRANSCRIBE_PROVIDER=openai
TRANSCRIBE_API_URL=https://api.openai.com/v1
TRANSCRIBE_API_KEY=sk-…
TRANSCRIBE_MODEL=whisper-1
```

### API and webhooks

Create API keys and webhooks under **Settings**. [`docs/API.md`](docs/API.md) covers:

- the endpoints and the data format
- the webhook events and retries
- how to verify signatures, in Node.js and Python
- connecting n8n

AI assistants connect to the MCP server at `/mcp` with a key ([`docs/help/mcp.md`](docs/help/mcp.md)). The WordPress plugin, the Zapier app, the n8n and Make templates and `@plaudit/react` are described in [`docs/help/wordpress.md`](docs/help/wordpress.md) and [`docs/help/integrations.md`](docs/help/integrations.md).

### Turning sections off

Forms, the new inbox, the widget studio, walls, importers, notifications, the setup guide, campaigns, the review booster, analytics, the image studio, the M13 import sources and auto-sync, customer records, translations, smart search, the M16 video tools and Insights are all on. To hide some (while your team gets used to the rest, say), list only the ones you want in `PLAUDIT_FEATURES` and restart, or set it to `none`:

| Flag | What it shows |
|---|---|
| `forms` | **Forms**: several forms per project with a builder (questions answered by video or text, optional questions, custom and hidden fields, design, 11 languages, per-form rules, templates) and a share panel with QR codes and embeds. See [`docs/help/forms.md`](docs/help/forms.md) and [`docs/EMBED.md`](docs/EMBED.md). Also **Project settings**: change a project's link (old links keep working), delete it by typing its name (owner only), a brand kit with logo, colours and fonts, and a tags manager |
| `widgets` | **Widgets**: saved widgets in 8 layouts (masonry grid, list, carousel, multi-card slider, marquee, single featured, rating badge, floating toast) with a studio: hand-picked or automatic testimonials, pins, filters, design, labels, a rating summary, a "Leave a testimonial" button and a live preview. Embed by script, iframe, hosted link, React component or a server-side HTML include for search engines. See [`docs/help/widgets.md`](docs/help/widgets.md) and [`docs/embeds/`](docs/embeds/README.md) |
| `walls` | **Walls**: several wall of love pages per project with an editor (five themes, hero, buttons, header links, cover, tag tabs, a call to action between cards, load more), drafts, a main wall for `/wall/<project>`, and SEO (meta, canonical, noindex, JSON-LD, link preview image). **SEO**: review snippets for your own pages, static or as a script. See [`docs/help/walls.md`](docs/help/walls.md) |
| `inbox2` | **Inbox**: the new Testimonials tab (without it, the classic dashboard). See [`docs/help/inbox.md`](docs/help/inbox.md) |
| `importers` | **Import & export → Import from a review site** ([`docs/IMPORT.md`](docs/IMPORT.md)) |
| `notifications` | **Settings → Notifications**: email and chat notifications ([`docs/help/notifications.md`](docs/help/notifications.md)) |
| `onboarding` | The setup guide at `/admin/welcome`, the **Get started** card and checklist ([`docs/help/getting-started.md`](docs/help/getting-started.md)) |
| `campaigns` | **Campaigns**: email campaigns with your own wording, sender, button and reminder days, recipients from a CSV or your customers, a live preview and test send, a funnel (sent, opened if you opt in, clicked, started, responded, declined), and auto-collect through `POST /api/v1/invites` or an incoming webhook ([`docs/help/campaigns.md`](docs/help/campaigns.md)) |
| `booster` | **Review booster**: pages of “Leave us a review” buttons (Google, Trustpilot, Yelp, Facebook, G2, Capterra, Tripadvisor, App Store, Google Play, any link or one of your forms) at `/b/<project>/<page>`, with a live preview, a Google review link helper, QR codes with your logo and print sizes, and cookieless click counts per day. Every visitor sees every link ([`docs/help/booster.md`](docs/help/booster.md)) |
| `share` | **Image studio**: images of 1, 3 or 6 testimonials in 14 templates of our own, with wording for the image only, colours, backgrounds, your logo and every social size (or your own), drawn on your server; PNG, JPEG, ZIP or copy; saved templates and the brand kit; “Share to X / LinkedIn” downloads the image and opens the site's own post page. Also **Create image** in the inbox drawer ([`docs/help/share.md`](docs/help/share.md)). Testimonials' own pages (`/t/<id>`) follow `walls`, and the video tools (trim, poster, replace, download; [`docs/help/video.md`](docs/help/video.md)) follow `inbox2` |
| `imports2` | **More importing**: 22 more sources (YouTube, Reddit, WooCommerce, Etsy, WordPress.org, Apple Podcasts, Feefo, Shopify review apps, Clutch, AppSumo, Udemy, and saved pages from Yelp, Facebook, LinkedIn, Tripadvisor, Amazon, Fiverr, Airbnb, Zillow, Realtor.com, the Chrome Web Store and Trustindex), **Keep this in sync** with an Automatically synced list, and Excel (.xlsx) files or a pasted table in the column mapper ([`docs/IMPORT.md`](docs/IMPORT.md)) |
| `customers` | **Customers**: a record per person with their testimonials, private feedback, invitations, campaign emails and rewards, editing, "Invite to a form", "Ask for a video" and "Add testimonial"; and in the inbox, **Possible duplicates** and **Merge into…** ([`docs/help/customers.md`](docs/help/customers.md)) |
| `translations` | **Translations** in the inbox drawer, by hand or with your provider (`TRANSLATE_PROVIDER`), "Translate new testimonials into" on forms, bulk Translate, and a widget option to show the visitor's language ([`docs/help/inbox.md`](docs/help/inbox.md#translations)) |
| `aisearch` | The inbox's **Smart search** switch: search by meaning with your own embeddings provider (`EMBEDDINGS_MODEL`), or a keyword search that says so when there's none ([`docs/help/inbox.md`](docs/help/inbox.md#smart-search)) |
| `api2` | **API, part 2**: the `/api/v1` paths for forms, widgets, walls, campaigns (and their recipients), tags, customers, private feedback and analytics. They make the same checks as the dashboard. Off, those paths answer 404 and `openapi.json` leaves them out ([`docs/API.md`](docs/API.md)) |
| `mcp` | **MCP server** at `/mcp` for AI assistants, with sign-in (OAuth 2.1: metadata, client registration, a consent page) or an API key, and the connected assistants under **Settings › API keys**. Off, `/mcp` and the OAuth endpoints answer 404 ([`docs/help/mcp.md`](docs/help/mcp.md)) |
| `team2` | **Roles and the audit log**: owner, admin, editor and viewer, per-project access for editors and viewers (enforced by the server on every request), API keys for one project, and **Settings → Audit log**. Off, everyone but the owner is an admin with every project and nothing is logged ([`docs/help/team.md`](docs/help/team.md)) |
| `video2` | **Video, part 2**: in the inbox drawer, a **multiclip** of a submission's video answers with a card for each question (download it, or show it as the testimonial's video) and **social clips** (9:16 or 1:1, word-by-word captions, your colour, logo and a name tag, in four looks); **Highlight reels** of your approved videos, chosen by selecting their words, with title and closing cards and our own background music; and your own **welcome and thank-you videos** on forms ([`docs/help/video.md`](docs/help/video.md)) |
| `insights` | **Insights** (Voice of Customer, ask a question, NPS, saved reports), **Case studies** with their public pages (`/cs/<id>`) and PDFs, **New survey** and **Add NPS question** in forms, **Case study** and **Read the screenshot** in manual add, and **Import a screenshot** ([`docs/help/insights.md`](docs/help/insights.md)) |
| `commerce` | **Commerce**: a project's Stripe connection with the **Sales popup** widget layout and **Verified purchase** marks ([`docs/help/sales-popup.md`](docs/help/sales-popup.md)), the **Stripe coupon** reward ([`docs/help/thank-you-coupons.md`](docs/help/thank-you-coupons.md)), and the inbox drawer's **Social post** panel with `socialDraft` on `testimonial.approved` webhooks ([`docs/help/social-drafts.md`](docs/help/social-drafts.md)). Off, the Stripe webhook answers 404 and sales popups show nothing. The browser extension needs only the API, so it works either way |
| `analytics` | **Analytics**: a dashboard at `/admin/analytics` (a period compared with the one before; new testimonials by source, the review backlog, average rating, widget views, visitors and clicks, form views and completions, wall views and CTA clicks, booster clicks, snippet renders and the invite funnel; sortable tables), panels on each widget, form and wall, and an alert when a widget stops showing on your site. Cookieless: a daily-salted hash instead of cookies, raw events kept 30 days, daily totals kept. `ANALYTICS=off` turns collection off too ([`docs/help/analytics.md`](docs/help/analytics.md)) |

`PLAUDIT_FEATURES=all` (the default) turns on every one. A flag only shows or hides pages: your data, the API and the public pages behave the same either way. The exceptions are `api2`, `mcp`, `team2` and `commerce`, which turn endpoints and checks on and off.

## Embedding

The project page in the dashboard generates both snippets for you. Approve a testimonial, or let [auto-approve](#auto-approve) do it, and it shows up on your site within about a minute (the widget's feed may be cached for up to 60 seconds).

```html
<!-- Script embed (recommended) -->
<script src="https://your-plaudit.example/widget.js" data-project="acme" data-theme="light" async></script>
```

| Attribute | Values |
|---|---|
| `data-theme` | `light`, `dark` or `auto` |
| `data-layout` | `grid` or `list` |
| `data-tag` | A tag name, to show only matching testimonials |
| `data-limit` | Maximum number of testimonials to show |
| `data-target` | CSS selector of an element to render into |

The JSON behind the widget is at `GET /api/widget/<slug>`. It is CORS-enabled and contains public fields only: never email addresses or consent records.

The iframe option is `/embed/<slug>?theme=dark`. It posts its height to the parent page so the snippet can size the iframe to fit.

A **saved widget** from the widget studio (preview flag `widgets`) is embedded by its id instead: `<script src="https://your-plaudit.example/widget.js" data-widget="w_abc123def456" async></script>`. Its layout, look and testimonials are set in the dashboard, and `data-project` embeds keep working exactly as before. See [`docs/EMBED.md`](docs/EMBED.md#saved-widgets).

## Backups, moving and upgrading

- **Export a project.** Go to **Import & export → Download everything**. The .zip contains:
  - `plaudit.json`: all data, including private fields, consent history, answers, edit history, old links, translations, customers, campaigns and their recipients, review boosters and their clicks, reward codes, and synced sources (never an API key; they arrive paused, as do active campaigns)
  - `testimonials.csv`
  - every video and photo
- **Import it** on any Plaudit server from the admin home page (**Import a project**). It becomes a new project with everything restored. Imported requests never send email by themselves.
- **Bring testimonials from elsewhere.** Go to **Import & export → Import testimonials from a CSV** (or a spreadsheet: .xlsx, or a table you paste). Columns are matched automatically and you can change the matches before importing. Videos and photos can be downloaded from URLs in the file.
- **Whole-server backup.** Copy `DATA_DIR`, or the `plaudit-data` Docker volume, while Plaudit is stopped. With [media in a bucket](#media-storage-s3), back up the bucket as well. For example:

  ```bash
  docker compose stop
  docker run --rm -v plaudit_plaudit-data:/data -v "$PWD":/backup alpine tar czf /backup/plaudit-backup.tgz -C /data .
  docker compose start
  ```

- **Upgrade.** Run `git pull`, then `docker compose up -d --build`, or `npm ci && npm run build` and restart. Database changes are applied automatically at start-up. Take a backup first.

## Privacy and consent

- Public pages, the widget and the iframe never include email addresses, consent records or unapproved testimonials.
- Every testimonial stores which consent wording the person saw (versioned, with a SHA-256 hash), what they agreed to, and when. If you change what someone wrote, it's marked **Edited after consent** and logged.
- People can withdraw using the private link shown after they submit (and, for requested testimonials, in the receipt email). Withdrawing unpublishes the testimonial, and it can't be approved again.
- IP addresses are not stored, unless you turn on `CONSENT_IP_HASH`, which stores a keyed hash.
- Analytics are cookieless: a saved widget, a wall and a step-by-step form send one small count to your own server, which keeps a hash of the visitor's address with a salt that changes daily and is deleted after two days, never the address itself. Raw events are deleted after 30 days. `ANALYTICS=off` turns it all off. What's collected, in words you can show your visitors: [`docs/help/analytics.md`](docs/help/analytics.md).
- Public pages load nothing from other sites, with one exception you choose: a wall can load Plausible or Google Analytics 4 if you pick one in its SEO tab, and then only that wall allows that provider ([`docs/help/walls.md`](docs/help/walls.md#favicon-analytics-and-verification)). Share links on a testimonial's own page are plain links.
- Customer records are owner-only: no public page, widget or feed shows them.
- Translation and smart search are off until you configure your own provider, and they're called from your server only, never while a public page is served. With smart search on, testimonial text goes to your embeddings provider; with a translation provider, the text you translate goes to it.
- You are the data controller for what you collect. Exports contain personal data, so store them securely.

See [`SECURITY.md`](SECURITY.md) for how to report a vulnerability and what Plaudit does to stay safe.

## Troubleshooting

| Problem | Fix |
|---|---|
| `SESSION_SECRET must be set` on start | Put a value of 16 or more characters in `.env` |
| Can't sign in | Check `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` (or the compose fallbacks) and restart. After 10 sign-in attempts within 15 minutes, wait for the window to pass. For Google, Apple and email links, see [sign-in troubleshooting](docs/AUTH.md#troubleshooting) |
| Signed out straight away over plain HTTP | `COOKIE_SECURE=true` needs HTTPS. Set it to `false` for local use |
| "ffmpeg isn't installed" in the dashboard | Install ffmpeg or set `FFMPEG_PATH`, restart, then press **Try again** on the video |
| Camera blocked on the collection page | Browsers only allow cameras on `https://` or `localhost`. Serve Plaudit over HTTPS |
| Emails don't arrive | Press **Send test email** in **Settings → This server**: it shows the mail server's exact error and what to do. **Requests** shows the error for each person. See [email troubleshooting](docs/EMAIL.md#troubleshooting) |
| Transcription failed | The dashboard shows the error. Run your `TRANSCRIBE_COMMAND` by hand with a WAV file to test it |
| Links in emails point to localhost | Set `PUBLIC_URL` to your real address |

## Development and tests

```bash
npm run dev         # development server with hot reload
npm run typecheck   # TypeScript
npm test            # Vitest: unit and integration tests (ffmpeg tests are skipped without ffmpeg, real-S3 tests without S3_TEST_ENDPOINT)
npm run test:e2e    # Playwright: builds and starts the production server, then runs the browser suites in Chromium
npm run test:all    # both
npm run build:extension  # the browser extension: dist/extension-chrome.zip and dist/extension-firefox.zip
```

The Playwright run starts the server with these settings, so every feature is tested end to end:

- `MAIL_OUTBOX=true`, so the tests can read the emails.
- A stand-in for whisper.cpp ([`e2e/fixtures/fake-whisper.mjs`](e2e/fixtures/fake-whisper.mjs)), so transcripts run without a model.
- `PLAUDIT_FEATURES=all`, so every section is tested.
- `STRIPE_API_URL` pointing at the fixture server, a stand-in for Stripe's promotion codes, so thank-you coupons run without a Stripe account. The extension's test loads `extension/` unpacked into Chromium (it's skipped in WebKit).
- With `E2E_WEBKIT=1` (after `npx playwright install webkit`), `npx playwright test --project=webkit` runs every spec in WebKit except the ones that record with the camera (`CAMERA_SPECS` in `playwright.config.ts`). CI runs both browsers.
- A fixture server ([`e2e/fixtures/fixture-server.mjs`](e2e/fixtures/fixture-server.mjs)) that stands in for the outside web. Two test-only settings let the app reach it: `NET_GUARD_ALLOW` lets exact `host:port` origins through the guard on outgoing requests, and `IMPORTER_ORIGINS` sends importers there instead of the real sites. Never set them on a real server.

| Suite | Covers |
|---|---|
| `e2e/flow.spec.ts` | The main story: create a project, then text, uploaded and recorded videos, moderation, the wall and embeds on another origin |
| `e2e/coverage.spec.ts` | Every surface on its own: home page, admin, form validation, moderation, wall, widget and iframe options, copy buttons, API privacy |
| `e2e/recorder.spec.ts` | Countdown, questions overlay, uploading while recording, dropped requests and resume, time limit, phone layout, the camera-app fallback, conversion and posters |
| `e2e/captions.spec.ts` | Transcript to editing to captions on the wall and in the cross-origin widget |
| `e2e/consent.spec.ts` | Consent wording, scopes, edit log, withdrawal |
| `e2e/requests.spec.ts` | Invitation email, prefilled link, receipt, unsubscribe |
| `e2e/api.spec.ts` | API keys against the REST API, signed webhooks |
| `e2e/data.spec.ts` | Export, import as a new project, CSV import with the mapper |
| `e2e/auto-approve.spec.ts` | Auto-approve: off by default, ratings, links, videos after processing, webhooks, the label, rejecting, phone layout |
| `e2e/sign-in.spec.ts` | The sign-in page, email links, Google and Apple, inviting and removing teammates |
| `e2e/security.spec.ts` | Security headers and CSP, media takedown, bad private links, rate limits |
| `e2e/project-settings.spec.ts` | Project settings: changing the link with old links still working, typed delete, brand kit, tags manager, phone layout |
| `e2e/security-settings.spec.ts` | Project settings: headers and CSP, cross-site changes refused, the logo served only as an image, old links that stay on this server |
| `e2e/walls.spec.ts` | Walls: the editor (hero, tabs, inline call to action, themes), publishing, drafts as 404, load more and infinite scroll, phones, meta and JSON-LD with JavaScript off, the link preview image, the main wall |
| `e2e/seo.spec.ts` | Review snippets: static and dynamic code on another site, guidance below 5 reviews, changing the scope |
| `e2e/security-walls.spec.ts` | Walls: headers and CSP on pages and images, drafts 404 everywhere, hostile text in cards and JSON-LD, no CSP violations in the editor |
| `e2e/video-share.spec.ts` | Video tools (trim with the waveform, poster frame, replace, downloads), a testimonial's own page and its image, the image studio from the drawer to a share intent, custom widget CSS on a cross-origin page, wall favicon, analytics and verification with its CSP |
| `e2e/import-inbox.spec.ts` | M13: an Excel file and a pasted table in the mapper, keeping an App Store import in sync (run now, pause, stop) and a saved-page source, possible duplicates and Merge into…, a customer's profile with edit, invite and add, a translation shown to a French visitor, smart search's keyword fallback, and 360 px |
| `e2e/team-api.spec.ts` | Single sign-on through a stand-in OpenID provider (allowed, refused, unverified), a viewer and an editor with their projects and refusals, the audit log, a Stripe trigger fired with a signed event, the API's new paths and the MCP server with a key made in Settings |
| `e2e/analytics.spec.ts` | Analytics: widget beacons from another site (only the app's origin contacted, no query kept), "Live on" and the removed alert, form drop-off and the classic page, wall CTA clicks, snippet renders, the dashboard at 360 px and in the dark theme, empty states |

To test a running instance instead, for example `docker compose up`, set `E2E_BASE_URL=http://127.0.0.1:3000`. Its `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` must match that instance's admin credentials. Tests that need the outbox, the stand-in transcriber or a local webhook receiver skip themselves when those aren't available. `UPDATE_SCREENSHOTS=1` refreshes the images in `docs/screenshots/`.

**Project layout**

| Path | Contents |
|---|---|
| `src/app/` | Pages and API routes (Next.js App Router) |
| `src/lib/` | The logic: storage, uploads, jobs, media, transcription, consent, requests, email, webhooks, export/import, zip, csv |
| `src/db/` | Drizzle schema. SQL migrations are in `drizzle/` |
| `public/widget.js` | The embed script (plain JavaScript, no build step) |
| `tests/` | Vitest. `e2e/` holds Playwright |
| `packages/react/` | `@plaudit/react` (built with `tsc`; its tests run in `npm test`) |
| `integrations/` | The WordPress plugin, the Zapier app, and n8n and Make templates |

## Project docs

- [`docs/AUTH.md`](docs/AUTH.md): sign-in with Google, Apple, single sign-on (OIDC) or an email link, and your team.
- [`docs/EMAIL.md`](docs/EMAIL.md): setting up email.
- [`docs/API.md`](docs/API.md): REST API and webhooks.
- [`docs/help/`](docs/help/README.md): the dashboard guides (getting started, forms, the inbox, widgets, walls and SEO, notifications); [`docs/EMBED.md`](docs/EMBED.md): embedding a form on your site; [`docs/IMPORT.md`](docs/IMPORT.md): importers.
- [`docs/SPEC.md`](docs/SPEC.md): product spec, what's shipped, and the roadmap.
- [`docs/research/feature-opportunities.md`](docs/research/feature-opportunities.md): the research behind the current features.
- [`docs/research/senja-teardown.md`](docs/research/senja-teardown.md): clean-room notes on how an existing commercial tool behaves.
- [`docs/CREDITS.md`](docs/CREDITS.md): where the sample media on the home page comes from.
- [`CHANGELOG.md`](CHANGELOG.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE)
