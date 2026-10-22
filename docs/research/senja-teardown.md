# Senja teardown (clean-room research notes)

_Researched 2026-10-21 from a Claude Code cloud session. Updated 2026-10-22 with a local REA run against senja.io's public pages (see "Local REA run" below); findings from that run are tagged *(observed)*._

This document describes how Senja (senja.io), a paid testimonial-collection SaaS, appears to work, so that we can specify an open-source alternative. It covers **behaviour and architecture only, in our own words**. No Senja source code, CSS, copy, logos, icons or images were copied into this repository, and none of it is used in the product. Short identifiers such as API field names, endpoint paths, hostnames and HTML attribute names are quoted where they describe an interface.

No accounts were created, nothing was signed into, and no testimonials were submitted to any real Senja form.

---

## 1. Method, and what REA could and couldn't do

### The plan

We meant to use [REA](https://github.com/morluto/rea) (`rea-agents` 6.7.0 on npm) against Senja's public pages and the public embed script:

| Command | Purpose |
|---|---|
| `capture-browser-scenario` | Network and console capture |
| `inspect-web-page` | Page inspection |
| `analyze-web-bundle` | Static bundle analysis |
| `export-web-scripts` | Script export |

### What actually happened

**The cloud sandbox's egress policy blocks senja.io.** Every host below was refused at the proxy (`CONNECT … 403`, logged as `connect_rejected`):
- `senja.io`, `www.senja.io`, `widget.senja.io`, `static.senja.io`, `api.senja.io`
- `web.archive.org`, `cdn.jsdelivr.net`
- general review sites: g2.com, zapier.com, alternativeto.net and others

The WebFetch tool also failed (`ENOTFOUND`) for every host. We did not try to get around the network policy.

**REA was installed and run.** It needs a Chromium-family browser, and the sandbox's preinstalled Playwright Chromium 141 worked.
- **Against senja.io:** `capture-browser-scenario` launched the browser, but navigation to `https://senja.io/` failed before the first state could be captured. The result was `execution_failure`, with 0 events and 0 steps. That is the network block, not an REA problem.
- **Against our own MVP:** REA worked as designed. A third-party HTML page served from another origin embedded our widget script. REA recorded the full flow with request/response headers and no page errors:
  1. `GET /widget.js`
  2. `GET /api/widget/<slug>` (JSON)
  3. Two video requests and one avatar request to `/api/media/...`

  So REA is usable in the cloud for any site the network policy allows. To run the planned Senja captures, add `senja.io` (and the `*.senja.io` hosts above) under **Allowed domains** in the environment's network settings and re-run. See https://code.claude.com/docs/en/cloud-environments#network-access.
- **Usage gotcha:** `capture-browser-scenario` takes its JSON input as a *positional* argument, not `--inputJson`. Network events are only recorded when `capture.events` includes `"network"`.

### The fallback

Because the target was unreachable, we used these sources instead:

1. **Web search result summaries** (search worked, page fetches did not). These are lower confidence and tagged *(search)* below.
2. **Open-source code that talks to Senja**, downloaded from the npm registry (reachable) and read as text, never executed:
   - `@activepieces/piece-senja`
   - `@agnocon/piece-senja` (a fork of the above, so not an independent source)
   - `@andrewconnell/senja-mcp`
   - `@thenavidm/senja-mcp-cli`, which ships an operations file its author transcribed from Senja's REST docs

   These give the public REST API shape and the testimonial object. Tagged *(code)*.
3. **Public GitHub repositories of Senja customers** that embed the widget on their own sites (code search turned up over 750 files using the embed). These show the embed snippet variants and hostnames. Tagged *(code)*.

Anything we reasoned out ourselves is tagged *(inferred)*.

### Local REA run (2026-10-22)

The cloud block does not apply on a local machine, so the planned captures were re-run there with REA 6.7.0 (`capture_browser_scenario`, headless Chromium 141 launched by REA). Scope stayed the same: public pages only, no account, no sign-in, nothing typed or submitted.

| Capture | What was recorded |
|---|---|
| `https://senja.io/` (Senja's own homepage, which embeds six of its own widgets) | Every network request; response bodies up to ~1 MB; request bodies; frames |
| One public collection form (`/p/<project>/r/<shortcode>`) linked from that homepage | Accessibility tree of the welcome step, then of the next step after one click on the start button. Stopped there. |

The six widget scripts and the analytics beacon were then read offline from the exported Evidence bundle. Findings are tagged *(observed)*. Limits of this run:
- One site, six widgets, one form. Other widget designs and form settings were not exercised.
- Response bodies are what Playwright's response API returned, which REA notes may not be byte-identical to the wire.
- The form was not taken past the "text or video" choice, so the recorder, upload limits and submit request were not observed.

---

## 2. Feature map

### Collecting testimonials

**Collection forms**: hosted per project at `senja.io/p/<project>/r/<shortcode>` *(code)*. The form app is a SvelteKit build (`/_pages-app/immutable/...` chunks); the marketing site around it is Astro *(observed)*. The observed flow *(observed)*:
1. **Welcome step**: heading, short intro message, an optional intro video from the form owner (thumbnail plus play button), a primary "start" button, and an optional reward teaser line.
2. **Prompt step**: the owner's guiding questions as a bullet list, then two choices: record a video (with a small secondary button beside it, likely the upload/alternative option) or write a text testimonial.
- The customer picks **text or video** and gives a **1–5 star rating**.
- Contact fields are name, email, avatar, job title/tagline, company, website and company logo. The "about you / company" fields can each be switched on and made required.
- Custom "additional fields" end up in a free-form `customer_custom_data` object *(code + search)*.
- Question text, button labels, logo, colours and font are editable. There are two generations of form design *(search)*.
- **Consent step** (optional): customers choose public, private or granular consent, and the testimonial can be filtered by it *(search)*. The field name is not exposed in any API client we saw.
- **Prefill** of name, email and URL via query parameters *(search)*.
- **After submitting**: a thank-you page, an optional reward page, a thank-you email, and a "share it socially" step *(search)*.
- **Video options**: record in the browser with the camera, or upload a file. An option nudges mobile users to film in landscape *(search)*.

**Requests by email ("invites")**: send a form to a list of recipients, after which the form's reminder/follow-up sequence runs. This is also available as an API call *(code)*. Automations can trigger requests after purchases (via Zapier) *(search)*.

**Imports**:
- One-off or auto-sync; auto-sync is paid only and has a minimum-rating filter *(search)*.
- Bulk CSV/XLS where name, rating and text are required *(search)*.
- A browser extension that grabs reviews from arbitrary pages, including LinkedIn recommendations *(search)*.
- Dedicated importers for platforms such as Trustpilot, Udemy, Capterra and Whop *(search)*.
- The API's `integration` enum lists about 35 source platforms: X/Twitter, LinkedIn, Google, Facebook, G2, Capterra, Product Hunt, App Store, Play Store, Trustpilot, YouTube, TikTok, Reddit, Yelp, Amazon and more *(code)*. Its spelling differs between clients (`product-hunt` vs `product_hunt`).

### Managing them

- **Moderation**: each testimonial has a single `approved` boolean. False means pending (hidden); true means published to widgets and walls. Imported items arrive for review too *(code + search)*.
- **Tags**: a free-form string list per testimonial, created on first use. Used to filter the API, widgets, and visitor-facing filters on walls *(code + search)*.
- **Editing**: the dashboard can edit testimonial content and author details. The public API can only toggle approval and add or remove tags *(code)*.
- **Search** across text, title and customer fields, with sorting by date or rating *(code)*.
- **AI extras** (low confidence, *(search)*):
  - video transcription (`video.transcript` in the API, which is *(code)*)
  - translations (`lang` and `translations[]`, *(code)*)
  - auto-generated social videos ("reels") with subtitles and music
  - copy generation and sentiment insights

### Showing them

- **Wall of love**: a hosted public page per project.
  - Holds up to 120 testimonials, with drag-and-drop ordering, tag filters and video *(search)*.
  - Unlimited walls on every plan; custom subdomain on paid plans *(search)*.
  - Each testimonial also has its own public page at `senja.io/p/<project>/t/<uuid>` *(code)*.
- **Widgets**: built in a designer area.
  - Roughly 10–20+ styles: masonry grid, auto-scrolling marquee, carousel, rating badge, and an image gallery, plus popups *(search)*.
  - Embedded on any site by copy-paste; see §5.
- **SEO rich snippets**: a separate script emits review-rating structured data, on the higher plan *(code + search)*.
- **Images and social graphics** of a single testimonial *(search)*.

### Integrations

- **REST API**: see §4.
- **Outbound webhooks**: `testimonial_created`, `testimonial_updated` and `testimonial_deleted`, with the payload `{type, data:{new, old}}`. Signed with an HMAC-SHA256 header *(code + search)*.
- **Zapier**:
  - Triggers: testimonial collected, testimonial approved.
  - Actions: import, find, create image, send request.

  *(search)*
- **Native Slack notifications**, added in 2026 *(search)*.
- **A hosted MCP server**, claimed by one third-party package and not independently confirmed *(code)*.
- **Website builders** (WordPress, Shopify, Kajabi, …) are handled with the same paste-in embed code, not native apps *(search)*.

### Plans (as of the search summaries; verify before quoting)

| Plan | Price | Limits |
|---|---|---|
| Free | $0 | 15 testimonials **in total**. Testimonials over the cap are still collected but hidden. 1 form, 1 project. Unlimited widgets and walls. |
| Starter | ~$29/mo | Unlimited testimonials. Branding removal, custom domain, auto-import. |
| Pro | ~$59/mo | More forms, projects and seats. Automations and rich snippets. |

*(search)*

**Takeaway**: the paywall sits on **volume** (15 testimonials) and **branding/custom domain**. A self-hosted tool removes both by default.

---

## 3. Inferred data model

**Testimonial**, as returned by the public API *(code)*:

| Group | Fields |
|---|---|
| Identity | `id`, `project_id`, `form_id` |
| Content | `type` (`text`\|`video`), `title`, `text`, `rating` (1–5), `lang`, `translations[]` |
| Status | `approved` (bool), `tags[]` |
| Origin | `integration` (source platform), `url` (original post), `date` (given on), `created_at`, `updated_at` |
| Author | `customer_name` (required), `customer_email`, `customer_tagline` (role line), `customer_company`, `customer_username`, `customer_url`, `customer_avatar`, `customer_company_logo`, `customer_custom_data{}` |
| Media | `video_url`, `thumbnail_url`, `media[]` of `{url, type: image\|video, alt?}`, `video{duration, aspect_ratio, hls_url, mp4_urls{low,medium,high}, transcript}` |

**Testimonial, as inlined into public widget scripts** *(observed)*. This is a different shape from the REST API above:

| Group | Fields |
|---|---|
| Identity | `id`, `project_id`, `asset_id` |
| Content | `type`, `text`, `html` (pre-rendered), `rating`, `lang`, `translations[]`, `date`, `created_at`, `vanity_metrics.outcome` (a short headline result) |
| Origin | `source` |
| Author | nested `customer` object: `id`, `name`, `avatar`, `tagline`, `company`, `company_logo`, `position`, `url`, `integrations{}`, `email_md5` |
| Media | `media[]`, `media_asset` (§6) |
| Grouping | `collection_items[]` (`collection_id`, `review_id`, `added_manually`), `form_responses[]` (multi-part answers; the renderer can split one testimonial into several cards, one per response) |

Note the public widget payload includes an `email_md5` field for the author (null in the items we saw). An MD5 of an email address is a well-known way to look up Gravatar profiles and can be reversed for common addresses, so **our public endpoints should not expose any email-derived value**.

**Other entities** *(inferred from URLs, the `/links` endpoint and help topics)*:
- **Project**: slug, brand kit, custom domain, API key. Plans limit how many you can have.
- **Form**: questions, design, consent step, company fields, thank-you/reward pages, follow-up email sequence, short public link.
- **Widget**: style, filters, theme.
- **Wall of love**: ordering, filters.
- **Tag**
- **Webhook**: URL, secret, events.
- **Invite**: recipient, form.
- **Case study / "sizzle reel"**: generated assets.

---

## 4. Public REST API (as used by third-party clients)

The base is `https://api.senja.io/v1`, with `Authorization: Bearer <per-project key>` *(code)*.

| Call | Behaviour |
|---|---|
| `GET /testimonials` | Filters: `query` (full text), `sort` (date\|rating), `order`, `approved`, `type`, `rating`, `integration`, `tags` (repeated), `lang`, `limit` (≤1000), `page`. Returns `{testimonials, total}`. |
| `GET /testimonials/{id}` | Returns `{testimonial}`, including video renditions. |
| `POST /testimonials` | Import or create. `type` and `customer_name` are required. A video is fetched from `video_url` by the server. |
| `PATCH /testimonials/{id}` | Only `approved`, `add_tags` and `remove_tags` can be changed. |
| `DELETE /testimonials/{id}` | Permanent. |
| `GET /links` | Public URLs and IDs of forms, widgets, walls and other assets. |
| `POST /invites` | `{form_id, recipients:[{email, name?}]}` sends the request emails. |

Rate limits and plan gating are undocumented in what we could reach.

---

## 5. How the embed works

Customer sites use one of three snippet shapes *(code, from public GitHub repos)*:

1. **Placeholder plus per-widget loader.** An empty `div` marks where the widget goes, carrying the widget's UUID in a `data-id` attribute. Options:
   - `data-mode="shadow"` renders inside Shadow DOM for CSS isolation
   - `data-lazyload`
   - `data-spinner`

   A script served at a per-widget URL on the widget host loads asynchronously and fills the placeholder.
2. **Placeholder plus generic loader.** The same placeholder, but with a single static loader script that scans the page for placeholders. The React/Next/Svelte guides use this and inject the script in an effect hook.
3. **Legacy iframe.** An iframe pointing at the widget host, plus a third-party auto-resize helper script that grows the iframe to its content height.

Hosts involved *(observed unless noted)*:

| Host | Role |
|---|---|
| `widget.senja.io` | Per-widget scripts at `/widget/<widget-uuid>/platform.js`, the rich-snippet script at `/rich-snippet/<project-uuid>.js`, the iframe resize helper, and an on-demand copy of an HLS player library |
| `cdn.senja.io` | Avatars and uploaded media, resized on the fly via `width`, `height` and `format=webp` query parameters |
| `image.mux.com` / `stream.mux.com` | Video thumbnails, animated WebP previews and HLS streams (see §6) |
| `ik.imagekit.io` | Some additional images |
| `analytics.senja.io` | Widget beacon (below) |
| static host | Generic loader *(code; not seen on this page)* |
| API host | REST *(code)* |

**There is no separate data request.** *(observed)* Each `platform.js` is a self-contained bundle (235 KB to 1 MB in the six we captured) made of:
- the widget renderer, compiled from Svelte;
- the widget record, inlined as JSON: `id`, `name`, `type`, `project_id`, `source`, `source_collection_id`, `updated_at`, `filters` (here always `{type: "curated", review_ids: [...]}`), `testimonial_arrangement` (`sort`, plus `order.positions` and `pinned` maps keyed by testimonial id), `config` (`version`, `design`, `customCss`, `showAttribution`, `autoSwapTranslations`, `sectionFilters`), and a `project` block with its brand kit, CTA and prompt;
- the selected testimonials, inlined as a JSON array (shape in §3).

So the widget host bakes a fresh script per widget, presumably whenever the widget or its testimonials change, and a visitor's browser makes one script request and renders entirely client-side. *(inferred)* That makes widgets cacheable at the CDN and fast, at the cost of a large payload for bigger walls.

**Design types seen** *(observed)*: `card_wall`, `avatars`, `avatars_pro`, `company_logos`, `toast` (popup) and `single_video`. Each widget's script appears to contain only the renderer for its own design. `config.design` carries per-design settings such as columns, max reviews, gap, card font/layout/border/shadow/radius, colour set, truncation and "read more" text, CTA text/URL, and a centred/avatars-count option for the avatar strip.

**Rendering modes** *(observed)*: with `data-mode="shadow"` the script attaches an open Shadow DOM root and injects the widget styles plus the owner's `customCss` into it. Otherwise it renders into the page.

**Analytics beacon** *(observed)*: the script tracks visibility and sends `POST https://analytics.senja.io/widget` with a JSON body of `load_session_id`, `widget_id`, `version`, `action` (`view` when the widget first becomes visible; `powered_by_click` when the attribution badge is clicked), `visitor_id`, `timestamp`, and a stringified `payload` with `page`, `host`, `design` type and `powered_by_enabled` (country is also referenced in the code). Both ids are random UUIDs generated in the browser.

**Rich snippet** *(observed)*: a tiny script that builds a schema.org `Product` object with an `AggregateRating` (best/worst rating, average, review count, hard-coded into the script at build time). If the page already has a JSON-LD block of a compatible `@type` (Product, Organization, Service, …) it merges the rating into that block and replaces it; otherwise it appends a new JSON-LD script to `<head>`.

**Other third-party scripts on Senja's own homepage** (marketing site, not part of the widget): PostHog (self-hosted under a Senja subdomain, with session recording and surveys), Segment, Google Analytics/Ads, Meta pixel, Sentry, Pirsch, RightMessage, FirstPromoter and Cloudflare Web Analytics *(observed)*.

## 6. How video works

- **Capture**: in-browser recording (camera and mic) or file upload, on desktop and mobile *(search)*.
- **Processing** *(code, inferred from API fields)*: after upload, the server
  - transcodes into an **HLS stream** and **three MP4 renditions** (low/medium/high)
  - extracts a **thumbnail**
  - records **duration and aspect ratio**
  - produces a **speech-to-text transcript**
- **Hosting and playback run on Mux** *(observed)*. Each video testimonial carries a `media_asset` whose `metadata` is a Mux asset record: `status`, `duration`, `aspect_ratio`, `tracks`, `playback_ids` (each with a `policy`), `static_renditions`, `mp4_support`, `normalize_audio`, `encoding_tier`, `resolution_tier`, `max_resolution_tier`, `max_stored_resolution`, `max_stored_frame_rate`, `upload_id` and `ingest_type`.
  - The widget picks the playback id whose policy is `public` and streams `https://stream.mux.com/<playback-id>.m3u8` (capped with `max_resolution=720p` in the single-video player).
  - Thumbnails come from `image.mux.com/<playback-id>/thumbnail.jpg|webp`, and hover/preview animations from `animated.webp?width=…`.
  - An HLS player library is lazy-loaded from the widget host only when a video is shown; Safari can play HLS natively.
- **Captions and transcript** *(observed)*: `media_asset.captions` holds both an `srt` caption file and a plain `transcript`; the player reads the SRT for subtitles.
- **"Moments"** *(observed fields)*: `moments_analyzed_at`, `moments_version`, `no_moments_reason`, plus `original_asset_id`/`original_asset` and `modified_start_seconds`, which suggests AI-picked highlight clips and trimmed edits derived from an original upload *(inferred)*.
- **Limits**: length and size limits are still unknown; sources conflict between "no cap", 2–5 minutes, and 500 MB *(search)*. Not observed, because the recorder was not opened.
- **Imports**: imported videos are pulled server-side from a URL *(code)*.

---

## 7. What this means for our design

1. **Core loop to copy (behaviourally)**: hosted form, then a pending queue, then approve/tag, then public wall and embeddable widget. Everything else is upsell.
2. **Data model**: one testimonial table with author fields, rating, text, optional video, approval status and tags. Keep emails private and never send them to public endpoints. Store explicit **consent** with a timestamp; the vendor treats consent as a first-class filter, and so should we.
3. **Embed**: offer both a Shadow-DOM script (style-isolated, no iframe) and an auto-resizing iframe. Our iframe resizes with a tiny built-in `postMessage` listener instead of a third-party helper. Use no analytics beacon by default.
4. **Video**: the MVP stores the original upload and streams it with HTTP Range support. Next steps are server-side transcoding (ffmpeg) for MP4/HLS and posters, then transcription with a pluggable speech-to-text model (e.g. Whisper).
5. **API and webhooks**: a token-authenticated REST API and HMAC-signed webhooks are cheap to add and unlock Zapier/n8n/Activepieces integrations.
6. **No volume caps or branding locks**: these are the vendor's main paywall levers, and a self-hosted tool has no reason to impose them.
7. **Widget data delivery** *(from the local REA run)*: the vendor inlines the data into a per-widget script, which means one request and easy CDN caching. Our MVP's script + JSON endpoint is simpler to build and keeps data fresh without a rebuild step. Good next step: add strong `ETag`/`Cache-Control` headers on the widget JSON, and optionally pre-render a per-widget static bundle later if payload size becomes an issue.
8. **Video pipeline target**: the vendor's stack (HLS with public playback ids, poster thumbnails, animated previews, SRT captions and a transcript, a 720p cap in small players) is a good roadmap for our self-hosted ffmpeg + Whisper path, without a paid video host.
9. **Privacy defaults**: no analytics beacon, no visitor ids, and no email-derived fields (such as `email_md5`) in any public payload.
10. **Rich snippets**: emitting schema.org `AggregateRating` and merging it into an existing Product/Organization JSON-LD block is small and worth adding.

## 8. Open questions

Answered by the local REA run (2026-10-22):
- ~~The exact widget data request and response, and the widget config schema.~~ No separate request; data is inlined in the per-widget script (§5).
- ~~What the rich-snippet script emits.~~ schema.org `AggregateRating`, merged into an existing JSON-LD block (§5).
- ~~What the analytics beacon collects.~~ See §5.
- Partly: **widget styles**. Six design types observed (§5); the full list needs more widgets.

Still open:
- The full widget style list and every theming option.
- The consent field shape.
- Video size and length limits, accepted formats, and the submit request (would need going past the "text or video" step without submitting, or a test form on our own account).
- Webhook retry behaviour.

## 9. Suspicious content encountered

- One downloaded package (`@thenavidm/senja-mcp-cli`) contains an agent-directed `SKILL.md` instructing AI agents to globally install the package. **Not followed.**
- Two package READMEs contain ordinary install and run instructions. **Not followed.**

Nothing was executed from any downloaded package, and no install scripts were run.

## 10. Sources

**Local REA captures (2026-10-22)**: `capture_browser_scenario` runs against `https://senja.io/` and one public collection form linked from it; Evidence exported with `export_evidence_bundle` and read offline. Not committed: it contains third parties' public testimonials.

**Packages, read locally**:
- npm `@activepieces/piece-senja` 0.2.1
- npm `@agnocon/piece-senja` 0.1.6
- npm `@andrewconnell/senja-mcp` 1.0.0
- npm `@thenavidm/senja-mcp-cli` 3.0.0, which cites support.senja.io/rest-api-wbnz4

**Public GitHub embed usage**:
- classroomio/classroomio
- AvdLee/RocketSimApp
- supavec/supavec
- joschan21/contentport
- Godefroy/rolebase
- rutikwankhade/CoverView
- duckduckgo/tracker-radar-wiki (`senja.io` domain page)

**Search summaries (pages not fetched)**:
- support.senja.io articles on: walls of love, free vs paid plans, the 15-testimonial cap, the REST API, webhooks, React embedding, widgets, imports (auto, CSV, extension, Trustpilot), forms and form settings, prefill, consent, custom domains, Zapier, sharing, and CSS limits
- feedback.senja.io: the video-limit request and the Slack changelog
- senja.io pages: pricing, testimonial widgets, comparison, and blog posts
- Third-party reviews: makerstack, g2, collectmonial, wisernotify
