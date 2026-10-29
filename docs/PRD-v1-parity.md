# Plaudit PRD v1: Senja + Shapo parity, then beyond

_Status: draft for build · Owner: Suresh · Written 2026-10-25 · Applies to: `open-video-testimonial` (Plaudit)_

## 0. How to read this

This PRD lists everything Plaudit needs so a customer who tries Senja or Shapo finds nothing missing in Plaudit, plus a few things neither of them does. It is written for the engineer or agent building it.

- **Section 3** is the gap table: one row per capability, what Senja and Shapo do, what Plaudit has today, and the priority.
- **Sections 4–17** are the module specs. Each requirement has an ID (`FORM-07`), the behaviour, and acceptance criteria (AC).
- **Section 18** is the data model, **19** the API and webhook changes, **20** the non-functional rules, **21** the release plan.
- Priorities: **P0** = needed to launch as "the open-source Senja/Shapo alternative". **P1** = within 2–3 months of launch. **P2** = later or optional.

### Clean-room rule (applies to every item)
We describe *behaviour*. We do not copy Senja's or Shapo's code, CSS, copy text, template designs, icons, names of their templates, or images. Widget layout names, default wording, email templates and image templates in Plaudit must be our own. Competitor screenshots live outside the repo, in `plaudit-review/competitor-screens/` (143 screens, with an index), and are never committed.

### Research behind this PRD
- A live walkthrough of both products signed in as the owner (free plans), with every screen captured. Notes: `plaudit-review/competitor-research/senja-live.md` and `shapo-live.md`.
- Public-docs inventories (about 355 Senja help articles and 158 changelog posts; 65 Shapo help articles, changelog and API docs): `senja-public.md`, `shapo-public.md`.
- Route maps taken from both apps' public bundles (Senja is SvelteKit with about 70 routes; Shapo is Next.js with 58 pages).
- An inventory of what Plaudit already ships (§2).

---

## 1. Product goal and positioning

**One line:** Plaudit is the open-source, self-hostable way to collect video and text testimonials, import your existing reviews, and show them anywhere, with consent and data ownership built in.

**Who it is for**
1. **Indie SaaS founders and creators** (Senja's core market): want a wall of love and widgets in 10 minutes.
2. **Small local and e-commerce businesses** (Shapo's core market): mostly want to *import* Google, Trustpilot and Shopify reviews and show them, plus a review booster page.
3. **Agencies**: many clients, white-label, one bill.
4. **Privacy-sensitive EU/UK teams and developers**: want self-hosting, GDPR consent records and an API.

**Why people would switch**
- Self-host for free, or pay for the cloud version. No lifetime 15-testimonial cap.
- A consent ledger and withdraw links. Neither competitor has these.
- An accessible video player with a caption track. Senja has none on its embedded player; Shapo has no transcription at all.
- Signed webhooks with retries and a full-edit API. Senja's API can't edit text; Shapo's webhooks are unsigned and form-only.
- SEO-friendly embeds: server-rendered HTML and JSON-LD. Both competitors render client-side (Senja in Shadow DOM, Shapo in iframes), so the review text never reaches the host page.

**Success metrics (cloud edition)**
- Time to first live widget: **under 5 minutes** from signup, median.
- 40% of new projects import or collect at least 3 testimonials in week 1.
- 25% of projects install a widget, as detected by our install ping.
- Self-host: 1,000 GitHub stars and 100 active instances within 6 months (opt-in telemetry only).

---

## 2. What Plaudit already has (baseline, 2026-10-25)

Full inventory: `docs/` plus the session inventory. Summary:

| Area | Shipped |
|---|---|
| Collection | `/c/[slug]` form with rating, text or video, name, email, title, company, photo, required consent plus optional social consent, honeypot and rate limit. In-browser recorder (MP4 on Safari/iOS, WebM elsewhere) with countdown, questions overlay, camera switch, time limit 15–600 s and file upload. Resumable chunked uploads. Thank-you screen with a private withdraw link. |
| Moderation | Pending/approved/rejected, delete, rename, tags, status filter with counts. Consent history panel. Transcript and caption editor, "use transcript as quote". |
| Video | ffmpeg converts to H.264/AAC MP4 and makes a poster. Transcription via a local command (whisper.cpp) or an OpenAI-compatible API. WebVTT captions are on by default. |
| Display | Wall `/wall/[slug]` (light/dark, tag filter, average rating). Iframe embed `/embed/[slug]`. `widget.js` in Shadow DOM (grid/list, theme, tag, limit). Public JSON feed. |
| Requests | Paste or CSV recipients, signed prefilled links, SMTP invites, up to 3 reminders, one-click unsubscribe, receipt email. |
| Platform | `/api/v1` with read and read-write keys, OpenAPI 3.1. Webhooks with 6 events, HMAC signatures, retries, delivery log and redeliver. Zip export/import, CSV export, CSV import with a column mapper (recognises Senja and Testimonial.to headers). |
| Auth and team | Password, magic link, Google, Apple. Owner and admin roles, team invites. |
| Privacy | Versioned consent wording, append-only consent events, "edited after consent" flag, withdraw link, IP hash option. Non-public media returns 404 to the public. |

**Known gaps, carried into this PRD:**
- **Collection:** one form per project, no custom fields, no rewards.
- **Moderation and data:**
  - The dashboard can't edit text, rating, title or company. There is no search, sort, pagination or bulk actions.
  - Projects can't be deleted and slugs can't be changed.
  - There are no owner notifications.
- **Display:** no widget builder, saved widgets, or other layouts. The only branding option is an accent colour.
- **Reach and integrations:** no importers from review sites, no analytics, no i18n, no generic OIDC.
- **Infrastructure:** local disk storage only and SQLite only.
- **Per-project auto-approve** is being built in the cloud agent's `claude/auto-approve` branch. FORM-30 below replaces it with per-form settings.

---

## 3. Gap table (capability × competitor × Plaudit)

Legend: ✅ has it · ◐ partial · ❌ missing · Pri = priority for Plaudit.

| # | Capability | Senja | Shapo | Plaudit now | Pri |
|---|---|---|---|---|---|
| **Onboarding** |||||
| 1 | Guided setup checklist | ✅ welcome page with "made for you" assets | ✅ 4-step wizard + sidebar progress | ❌ | P0 |
| 2 | Scrape your website for brand and existing testimonials on signup | ✅ (logo, colours, testimonials found on site) | ❌ | ❌ | P1 |
| 3 | Auto-create a form, wall, widgets and images on signup | ✅ | ◐ (one carousel widget) | ❌ | P0 |
| **Collection forms** |||||
| 4 | Multiple forms per project | ✅ (plan-limited) | ✅ unlimited | ❌ one per project | P0 |
| 5 | Multi-page flow: welcome, questions, about you/company, consent, review, thank-you | ✅ 11 page types, toggles | ◐ 3 pages | ◐ single page | P0 |
| 6 | Several questions, each answered by video, text or both; tips per question | ✅ | ❌ one message | ◐ one answer + question tips | P0 |
| 7 | Rating page, optional | ✅ | ✅ toggle | ✅ | — |
| 8 | Low-rating branch to private feedback | ✅ (1–3★ go to feedback) | ◐ rating-based thank-you page | ❌ | P1 (off by default, see FORM-12) |
| 9 | Private feedback question | ✅ | ❌ | ❌ | P1 |
| 10 | Custom fields (short, long, dropdown, checkbox, NPS), required flag, hidden and prefill fields | ✅ | ✅ (5 types; dropdown maps to a tag) | ❌ | P0 |
| 11 | Person fields toggles (email, photo, phone, socials, job, company, website, logo) | ✅ | ✅ | ◐ fixed set | P0 |
| 12 | Consent page: public/private + granular scopes | ✅ | ◐ fine-print only | ✅ (best of the three) | — keep |
| 13 | "Ready to send" review step | ✅ | ❌ | ❌ | P1 |
| 14 | Thank-you page: custom text, CTA, share/copy own text, rating-based variants, thank-you video | ✅ | ✅ (copy text, positive/negative) | ◐ text + withdraw link | P0 |
| 15 | Welcome and thank-you video from the owner | ✅ (paid) | ❌ | ❌ | P2 |
| 16 | Rewards: coupon or link, "spin the wheel", video-only | ✅ | ❌ | ❌ | P1 |
| 17 | Form design: logo, colours, Google fonts, layout, button style, remove branding | ✅ | ✅ (GDPR fonts) | ◐ accent colour | P0 |
| 18 | Edit every label, any language, RTL | ◐ write in your language | ✅ labels + RTL | ❌ English only | P0 (labels) / P1 (shipped locales) |
| 19 | Per-form settings: slug, auto-approve, auto-tag, confirmation email, pause, landscape prompt, notifications, webhook | ✅ | ✅ (status, tags, webhook) | ◐ project-level | P0 |
| 20 | Form embed (inline) + hosted link + QR | ✅ | ✅ | ◐ link only | P0 |
| 21 | Form analytics (views, starts, completions) | ◐ visits/response rate | ✅ | ❌ | P1 |
| 22 | Draft autosave for the customer | ✅ 7 days | ❌ | ◐ resumable uploads | P1 |
| **Requests and outreach** |||||
| 23 | Email invites + reminders + tracking (sent, opened, clicked, responded) | ✅ (1/3/7 days, fixed) | ✅ campaigns (Pro) | ◐ no open/click tracking | P1 |
| 24 | Personalisation variables, sender name, test email, RTL | ◐ | ✅ | ◐ | P1 |
| 25 | Auto-collect triggers (Stripe, Shopify, Zapier, `POST /invites`) | ✅ | ◐ incoming webhook | ◐ API only | P1 |
| 26 | Review booster page: links to Google, Yelp, Trustpilot and others | ❌ | ✅ | ❌ | P1 |
| 27 | QR code for the form or booster | ❌ (via share) | ✅ free tool | ❌ | P1 |
| **Import** |||||
| 28 | Manual add: text, video, image/screenshot (OCR), case study | ✅ | ✅ text/video | ❌ (API/CSV only) | P0 (text, video, image) / P2 (OCR) |
| 29 | CSV/XLSX import with mapping | ✅ | ✅ CSV | ✅ CSV | P1 (XLSX) |
| 30 | Import from review platforms by URL or search | ✅ ~30 | ✅ ~35 | ❌ | P0 (top 8) / P1 (rest) |
| 31 | Auto-sync of new reviews (12–24 h) with min rating, tag, auto-approve | ✅ | ✅ (Pro) | ❌ | P1 |
| 32 | Migrate from competitors (Testimonial.to wall, Senja, Shapo) | ✅ Testimonial.to | ❌ | ◐ CSV header mapping | P0 |
| 33 | Browser extension "grab from any page" | ✅ | ❌ | ❌ | P2 |
| **Manage (inbox)** |||||
| 34 | Search, including AI natural-language search over transcripts | ✅ | ◐ keyword | ❌ | P0 keyword / P1 semantic |
| 35 | Filters: status, source, rating, tags, form, type, language, has media, word count, date | ✅ | ✅ | ◐ status, tag | P0 |
| 36 | Sort, pagination, bulk approve/hide/tag/delete | ◐ no sort | ✅ | ❌ | P0 |
| 37 | Edit all fields, highlight phrases, title, source URL, date | ✅ | ✅ | ◐ API only | P0 |
| 38 | Customer profile (all testimonials, feedback, actions per person) | ✅ | ❌ | ❌ | P1 |
| 39 | Translations per testimonial (auto, 20+ languages) | ✅ Pro | ◐ import-time translate | ❌ | P1 |
| 40 | Trash/undo, edit history | ❌ | ❌ | ❌ | P1 (our advantage) |
| 41 | Statuses: pending, approved/public, hidden, rejected | ✅ | ✅ | ✅ | — |
| **Video** |||||
| 42 | Transcription | ✅ | ❌ | ✅ | — |
| 43 | Trim start/end, poster pick, replace | ✅ | ❌ | ❌ | P1 |
| 44 | Multiclip stitch of multi-question answers | ✅ | ❌ | ❌ | P2 |
| 45 | Caption track on the embedded player | ❌ | ❌ | ✅ | — keep |
| 46 | Adaptive streaming (HLS) | ✅ Mux | ❌ | ❌ | P2 |
| 47 | AI highlight reels / social videos with burned-in captions | ✅ credits | ❌ | ❌ | P2 |
| **Display** |||||
| 48 | Saved widgets with live-preview builder | ✅ | ✅ | ❌ (URL params) | P0 |
| 49 | Layout families: grid/masonry, list, carousel, multi-carousel, marquee, single, rating badge, avatars, logos, toast/popup, video embed, image gallery | ✅ ~22 | ✅ 8 | ◐ grid, list | P0 (8) / P1 (rest) |
| 50 | Filters per widget: tags, min rating, sources, type, keywords; manual pick, order, pin | ✅ | ◐ no manual pick | ◐ tag, limit | P0 |
| 51 | Design: colours, font, card, shadow, date, toggles (avatar, source icon, read more, first name only) | ✅ | ✅ | ◐ theme | P0 |
| 52 | Labels and auto-translation by visitor language | ✅ Pro | ✅ labels | ❌ | P1 |
| 53 | "Leave a testimonial" CTA linked to a form | ◐ | ✅ | ◐ wall only | P0 |
| 54 | Custom CSS | ✅ beta | ❌ | ❌ | P1 |
| 55 | Embeds: script, iframe, hosted link, React, WordPress plugin, Wix, Framer | ✅ (no plugins) | ✅ | ◐ script + iframe | P0 (script/iframe/link/React) / P1 (WordPress) |
| 56 | Install detection + "widget removed from your site" alert | ❌ | ✅ | ❌ | P1 |
| 57 | Widget analytics (views, visitors, clicks, sites) | ◐ 30 days | ✅ | ❌ | P1 |
| 58 | Wall of Love editor: hero, CTA, nav links, filter tabs, SEO meta, themes, inline CTA, load more, publish/draft | ✅ | ✅ | ◐ fixed page | P0 |
| 59 | Rich snippets / Google stars JSON-LD | ✅ Pro | ✅ free | ❌ | P0 |
| 60 | Single testimonial page with CTA + OG image | ✅ | ◐ video page | ❌ | P1 |
| 61 | Sales popup from Stripe purchases | ✅ new | ❌ | ❌ | P2 |
| **Share assets** |||||
| 62 | Image studio: templates, backgrounds, logo, platform sizes, PNG/ZIP export, saved templates | ✅ | ◐ one card template | ❌ | P1 |
| 63 | AI case study from a testimonial (+ PDF) | ✅ | ❌ | ❌ | P2 |
| **Analyse** |||||
| 64 | Voice of Customer: themes, "what they love/improve", ask a question | ✅ | ◐ AI surveys insights | ❌ | P2 |
| 65 | NPS / feedback / AI surveys | ❌ | ✅ | ❌ | P2 |
| 66 | Unified analytics dashboard | ◐ | ✅ | ❌ | P1 |
| **Customer success** |||||
| 67 | Thank-you emails/gifts with tracking (Stripe) | ✅ | ❌ | ◐ receipt email | P2 |
| **Platform** |||||
| 68 | Projects/workspaces (one per brand/client) | ✅ | ✅ | ✅ | — |
| 69 | Roles: admin, editor, viewer/sharer, per-project access | ✅ | ✅ | ◐ owner/admin | P1 |
| 70 | Custom domain for walls, forms, booster + custom sending address | ✅ | ◐ wall + booster | n/a self-host / ❌ cloud | P1 (cloud) |
| 71 | Remove branding, affiliate link in badge | ✅ | ✅ | n/a (no branding) | cloud P1 |
| 72 | Notifications: email, Slack, Discord, Teams, weekly digest | ✅ | ◐ email digests | ❌ | P0 |
| 73 | REST API full CRUD | ◐ no text edit | ◐ limited | ✅ | extend P0 |
| 74 | Webhooks | ◐ 3 events | ◐ unsigned, form only | ✅ | extend P1 |
| 75 | Zapier / Make / n8n | ✅ Zapier | ❌ | ❌ | P1 |
| 76 | MCP server for AI assistants | ✅ | ❌ | ❌ | P1 |
| 77 | Billing, plans, trials, limits (cloud edition) | ✅ | ✅ | ❌ | P0 for cloud, not self-host |
| 78 | Free SEO tools as lead magnets (review link, QR, badge, schema, review-to-image) | ◐ | ✅ 7 tools | ❌ | P1 (marketing) |

---

## 4. Onboarding (ONB)

**Target flow (cloud and self-host first run)**
1. Sign up (existing auth) → "What's your website?" (URL, optional) and "What do you sell?" (single choice: SaaS, course, coaching, agency/services, e-commerce, local business, creator/newsletter, other). The second answer only tunes default wording and templates.
2. If a URL was given, a background job fetches the homepage and runs these in parallel:
   - **Brand:** logo (from `og:image`, `apple-touch-icon` or the largest `<img>` in the header), primary colour (theme-color meta, or the dominant non-neutral colour of the logo), and site name.
   - **Existing testimonials:** heuristic extraction of quote blocks with a name nearby, from `blockquote`, `figure`, and `[class*=testimonial|review]`. An LLM pass is used when one is configured.
3. "We found N testimonials on your site": a selectable list (Select all / Clear), then import the chosen ones as `approved`, `source=website`.
4. Create defaults automatically: one project, one form, one wall, and two saved widgets (a grid and a carousel). The import step is skippable.
5. Land on **Get started**: a checklist card that also sits in the sidebar until finished: ① import or collect testimonials ② create or customise a widget ③ add it to your site (install detected) ④ share your form link / send invites. Each step has a "Skip".

| ID | Requirement | AC |
|---|---|---|
| ONB-01 | First-run wizard (name, website, business type) | New owner sees it once; can skip; answers saved to project |
| ONB-02 | Brand scrape job | Given a URL, within 30 s: logo + primary colour + name stored on project; failure is silent and falls back to defaults; respects robots.txt, 5 MB cap, 10 s timeout, no private IPs (reuse `IMPORT_ALLOW_PRIVATE_URLS` guard) |
| ONB-03 | Testimonial discovery on own site | Shows found items with name/title/text; imports chosen ones; zero found → message + next step |
| ONB-04 | Auto-created starter assets | Form, wall, 2 widgets exist after onboarding, all branded with scraped colour/logo |
| ONB-05 | Get-started checklist | 4 steps with live state; "install" step turns green when an install ping (DISP-30) arrives; dismissible after completion |
| ONB-06 | Empty states everywhere | Every list page (testimonials, forms, widgets, campaigns) has an empty state with one primary action |

---

## 5. Collection forms (FORM)

### 5.1 Model
- A **project** has many **forms**. Each form has an ordered list of **pages**; each page has `type`, `enabled` and type-specific `config`. A form has `design`, `labels` (per language), `settings` and `reward`.
- Public URL: `/f/<project-slug>/<form-slug>`. Keep `/c/[slug]` as a redirect to the project's default form.
- **One step per screen** on mobile, with a top progress bar and a back button. Desktop uses the same flow, centred.

### 5.2 Page types (in default order; each can be toggled except Question 1)
| Page | Owner config | Customer sees |
|---|---|---|
| **Rating** | title, subtitle (rich text), CTA label, required yes/no, scale 5 stars | 5 stars + Continue |
| **Welcome** | title, rich subtitle, bullets, CTA label, "time needed" line, privacy line, optional owner video | intro + start button |
| **Question 1 (primary)** + Questions 2..N | title, subtitle (optionally different for video vs text), tips list (add/drag/delete), response mode Video+text / Video only / Text only, max video length (15 s–10 min), allow image attachments (≤3), required/optional (**optional is our advantage**; Senja makes every question required), labels | answer by recording, uploading or typing |
| **Private feedback** | title, subtitle, placeholder, optional | free text stored as private feedback (never public) |
| **Consent** | reuse Plaudit's versioned consent; labels for public/private; granular scopes (website, social, ads, name, face) | radio + optional scope checkboxes |
| **About you** | field toggles + required: name*, email, photo, phone, X/LinkedIn/Instagram/TikTok handle, plus custom fields | inputs |
| **About company** | job title, company, website, company logo, plus custom fields | inputs |
| **Review & send** | title, subtitle, CTA | read-only summary of answers + chosen consent, edit links back |
| **Thank you** | title, rich message; variants by rating (≥4 / ≤3); CTA (button text + URL, e.g. "Also review us on Google"); show "copy my testimonial" box; social share buttons; optional owner thank-you video; reward reveal | confirmation, withdraw link (keep), CTA |

| ID | Requirement | AC |
|---|---|---|
| FORM-01 | Multiple forms per project; list with search, list/expanded view, per-form stats (invites, unique visits, submissions, response rate), menu: edit, share, duplicate, pause, delete | CRUD works; deleting a form keeps its testimonials (form_id set null) |
| FORM-02 | Form builder UI: left = page list (toggle, reorder questions); centre = live preview of the selected page; right = settings for that page; tabs **Content / Design / Settings / Share** | Every change previews instantly; unsaved-changes guard **only when something changed** (Shapo prompts even when nothing changed) |
| FORM-03 | Page engine per §5.2 | Toggled-off pages are skipped; back button keeps answers |
| FORM-04 | Multiple questions with per-question response mode and tips | A submission stores one **answer** per question (text and/or video); the primary answer is the testimonial's main text/video |
| FORM-05 | Optional questions | Customer can skip a question marked optional |
| FORM-06 | Custom fields: short text, long text, dropdown, checkbox, NPS 0–10, URL, number; required; placeholder; "map dropdown option → tag" | Values saved on the testimonial (`custom_fields` JSON) and shown in the inbox detail; private by default; exported in CSV |
| FORM-07 | Hidden fields from URL params (`?utm_source=`, `?order_id=`) and prefill (`?name=&email=&company=&title=`) | Hidden values saved; prefilled fields editable unless locked; keeps existing signed `?r=` tokens |
| FORM-08 | Design: logo upload, show/hide logo, primary colour, background, text, button colour and text colour, star colour, heading and body font (self-hosted Google Fonts subset, so no third-party request), layout wide/compact, button style solid/soft, corner radius, light/dark | Preview matches the public page pixel-for-pixel for the same viewport |
| FORM-09 | Labels: every UI string editable; language selector per form with shipped translations (en, es, fr, de, pt, it, nl, pl, hi, ta, ar) and RTL auto for ar/he/fa | Changing language swaps all default strings; owner overrides win |
| FORM-10 | Per-form settings: slug (warn that old links break, keep a 301 from the old slug), **auto-approve rule** (off / all / rating ≥ N / text only / with consent=public), auto-tags, confirmation email to customer (template), notification targets, landscape prompt on mobile, pause (closed message), max submissions per IP, webhook override | Rules applied at submit; auto-approved items emit `testimonial.approved` |
| FORM-11 | Share panel: hosted link (copy), QR code (PNG/SVG, colour), inline embed snippet (`<div data-plaudit-form>` + script), popup/floating-button embed, iframe | All four embeds render and submit cross-origin |
| FORM-12 | Low-rating branch (optional, **off by default**): if rating ≤ threshold, show the private feedback page instead of questions; store as feedback, not testimonial | Owner sees a notice: "Don't use this to gate reviews for Google/Trustpilot. Their policies forbid it. It's fine for private testimonials." Booster pages never gate (BOOST-03) |
| FORM-13 | Rewards: none / same reward for all (coupon code or URL) / spin-the-wheel (prizes with label, code, weight %) ; "only for video" toggle; reward shown on thank-you + in confirmation email; **unique codes from a CSV pool** (Senja lacks this); claim tracking | Reward delivered once per submission; pool decrements; wheel odds respected within ±2% over 10k simulated spins |
| FORM-14 | Draft autosave | Text answers and step saved to localStorage for 7 days; resume prompt on return |
| FORM-15 | Form analytics | Per form: views, unique visitors, starts, completions, completion %, avg rating, per-page drop-off; cookieless (daily salted hash) |
| FORM-16 | Thank-you "copy my words" + share | Copy button copies the customer's text; share opens X/LinkedIn/Facebook intents with their quote (only if consent includes social) |
| FORM-17 | Owner welcome/thank-you videos (P2) | Owner records/uploads in builder; plays on those pages with captions |
| FORM-18 | Templates: start a form from presets (SaaS, course, coaching, agency, e-commerce product, local business, employee testimonial, event) | Each preset = page set + questions + tips in our own wording |

---

## 6. Requests, campaigns, auto-collect (REQ)

The building blocks already exist: requests, reminders and unsubscribe. This section extends them into **campaigns**.

| ID | Requirement | AC |
|---|---|---|
| REQ-01 | Campaign entity: name, destination form (or booster), sender name, reply-to, subject, body with variables `{{name}} {{first_name}} {{company}} {{link}}`, button text, RTL, reminders (0–3, **custom day offsets**: Senja's are fixed at 1/3/7) | Campaign list with stats |
| REQ-02 | Recipients: paste, CSV (name, email, company, title, custom vars), from existing customers, manual add; dedupe; skip unsubscribed and already-responded | Import report lists skipped rows with reasons |
| REQ-03 | Live email preview + "send test to me" | Preview equals sent mail |
| REQ-04 | Tracking per recipient: queued, sent, delivered/bounced, opened (pixel, optional), clicked, started, submitted, unsubscribed, declined | Funnel shown on campaign page; open-tracking can be switched off for privacy |
| REQ-05 | "Decline" link (customer says no thanks → no more reminders) | Status `declined` |
| REQ-06 | Sending: existing SMTP for self-host; cloud uses provider (SES/Postmark) with per-project verified sending domain (SPF/DKIM check UI) | Test send shows auth result |
| REQ-07 | Auto-collect: `POST /api/v1/invites` (exists conceptually) + incoming webhook URL per campaign + native triggers (P1): Stripe `checkout.session.completed`/`invoice.paid`, Shopify order fulfilled, delay N days | A Stripe test event creates a queued invite after delay |
| REQ-08 | Per-recipient unique reward codes (ties to FORM-13) | Code appears in email/thank-you |

---

## 7. Review booster and QR (BOOST), P1

A small hosted page, `/b/<slug>`, with "Leave us a review" buttons for each platform the owner adds: Google, Trustpilot, Yelp, Facebook, G2, Capterra, TripAdvisor, App Store, Play Store, a custom link, or the Plaudit form.

| ID | Requirement | AC |
|---|---|---|
| BOOST-01 | Editor: up to 10 links (platform icon, label, URL, drag order), page title/message, logo, colours, button style, mobile/desktop preview, draft/public | Public page renders <50 KB |
| BOOST-02 | Google review link helper: business search → Place ID → `https://search.google.com/local/writereview?placeid=` | Works with a configured Google Places API key; otherwise manual URL |
| BOOST-03 | No gating: every visitor sees every link | Enforced |
| BOOST-04 | QR code generator for booster/form (PNG/SVG, colour, logo in centre, print sizes) | Scans on iOS/Android camera |
| BOOST-05 | Click analytics per link | Daily counts |

---

## 8. Import (IMP)

### 8.1 Manual add (P0)
A modal with tabs **Text / Video / Image (screenshot) / Case study (P2)**.

Fields: name\*, tagline/title, company, email, avatar, company logo, rating, title, text (highlightable), attach up to 5 images, video file (goes through the existing pipeline), source platform (dropdown) plus source URL, date, tags, status (default approved).

The Image tab can run optional OCR (P2) through a configurable provider, to pull the quote text out of a screenshot.

### 8.2 Platform importers (P0: top 8; P1: the rest)
One flow for every source: **pick source → identify (URL, search or ID) → options → preview list → select → import → optional auto-sync**.

- **Options:** minimum rating, skip reviews with no text, translate to the project language (needs the translation provider), tags to apply, and status on import (approved or pending).
- **Preview:** shows the latest 50 with checkboxes. "Import all matching" (up to 1,000) runs as a background job with progress, using the existing jobs table.
- **Every imported item stores:** `source`, `source_url`, `source_review_id` (dedupe key), `source_date` and `imported_at`.
- **Dedupe:** re-running an import never creates duplicates (unique on project + source + source_review_id).

| Tier | Sources | Method (prefer official APIs, then public structured data, then page parse) |
|---|---|---|
| P0 | Google Business (Places API key, BYO in self-host), Trustpilot (public business page JSON-LD), G2, Capterra, Product Hunt, App Store (RSS/JSON), Google Play, X/Twitter (single post URL via oEmbed) | adapters in `src/lib/importers/<source>.ts` with a common interface |
| P1 | Yelp, Facebook (page URL; may need login → manual), LinkedIn post URL, YouTube comment/video URL, Reddit post, TripAdvisor, AppSumo, Udemy, Shopify store (detect Judge.me/Loox/Okendo/Yotpo/Stamped/Reviews.io), WooCommerce Store API, Etsy, Amazon, Clutch, Fiverr, Airbnb, Zillow/Realtor, Chrome Web Store, WordPress.org plugins, Apple Podcasts, Feefo, Trustindex | same interface |
| P0 | **Migrations**: Testimonial.to wall URL, Senja (CSV export + API key), Shapo (API key or CSV) | maps to our model incl. video URLs (downloaded via `import.media`) |

| ID | Requirement | AC |
|---|---|---|
| IMP-01 | Importer framework + job + preview UI | Adding a new source = one adapter file + icon + test fixture |
| IMP-02 | Auto-sync (P1): per source connection, interval 12/24 h, filters, auto-approve, auto-tag, "Automatically synced" list with last run/status, pause/delete | New review on source appears after next run; failures alert owner after 3 misses |
| IMP-03 | Legal/ToS guard | Each adapter declares `method` and `tosNotes`; UI shows "You must own this business listing" checkbox before importing; we never import from listings the user can't claim (documented, not technically provable) |
| IMP-04 | XLSX + paste table import (P1) on top of the existing CSV mapper | Same preview/warnings |
| IMP-05 | Fuzzy dates | When a source gives month-only dates, store `date_precision=month` and display "Oct 2026" (Senja silently uses the 22nd) |
| IMP-06 | Free-plan/limit hooks (cloud) | Import respects plan caps; self-host unlimited |

---

## 9. Inbox and testimonial management (INBOX)

**Layout:** a table view (dense: select box, person, text, source icon, status, date, actions) and a card view (full Q&A, media). The user can toggle between them, and the choice is remembered.

| ID | Requirement | AC |
|---|---|---|
| INBOX-01 | Status tabs with counts: All · Pending · Approved (public) · Hidden · Rejected · Feedback (private) · Trash | Counts update live |
| INBOX-02 | Search: keyword over text, transcript, name, company, email, tags (SQLite FTS5) | <200 ms on 10k rows |
| INBOX-03 | Filters panel: source (icon grid), rating (N/A,1–5, multi), tags (AND/OR), form, type (text/video/image), language, has avatar/logo/images, consent scope, word count range, date range, import method (form/manual/CSV/platform/auto-sync/API) | Filters combine; shareable URL query |
| INBOX-04 | Sort: date added, date posted, rating, name, word count; asc/desc | Persisted per user |
| INBOX-05 | Pagination 25/50/100 | Server-side |
| INBOX-06 | Bulk actions: approve, hide, reject, tag/untag, move to trash, export selection, (P1) translate | One request, one audit entry per item |
| INBOX-07 | Detail drawer: all answers per question, media player with captions, custom fields, hidden fields, consent panel (keep), source link, history | Opens from row; keyboard nav (j/k, a = approve, h = hide) |
| INBOX-08 | Edit: name, title, company, website, avatar, logo, rating, testimonial title, text of **every** answer (Senja edits only the primary), date, source + URL, language, tags; highlight phrases (select text → highlight); "edited after consent" flag kept | Edits logged |
| INBOX-09 | Trash with 30-day restore; permanent delete from trash only | Restore returns item and media |
| INBOX-10 | Edit history per testimonial (who/when/what) | Visible in drawer |
| INBOX-11 | Duplicate, merge two testimonials of the same person | Merge keeps both answers |
| INBOX-12 | Customer records (P1): one per email/handle; profile shows all testimonials, feedback, invites, rewards; actions: invite to form, ask for video, add testimonial | Auto-linked on submit/import |
| INBOX-13 | Translations (P1): add/edit per language; auto-translate via provider (DeepL/LibreTranslate/OpenAI-compatible, BYO key); auto-translate on submit per form | Widgets can show by visitor language |
| INBOX-14 | AI search (P1, optional provider): natural-language query → embeddings over text + transcript | Toggle; falls back to keyword |
| INBOX-15 | Export: CSV/JSON of current filter (keep zip export) | Columns include custom fields |

---

## 10. Video tools (VID)

| ID | Requirement | AC |
|---|---|---|
| VID-01 | Trim start/end in the drawer with a waveform and preview; non-destructive (stores in/out points, re-renders MP4) | Original kept; trimmed MP4 served |
| VID-02 | Pick poster frame (scrub) or upload custom thumbnail | Poster updates everywhere |
| VID-03 | Replace video file | Pipeline reruns; transcript regenerated |
| VID-04 | Download original/converted MP4 | Owner only |
| VID-05 | Multiclip (P2): stitch answers of one submission into one MP4 with title cards between questions | ffmpeg concat; downloadable (Senja's isn't) |
| VID-06 | HLS (P2) via ffmpeg segmenting or S3 + CDN | Player switches by bandwidth |
| VID-07 | Social clip renderer (P2): vertical 9:16 / square, burned-in word-by-word captions from VTT, brand colour bar, logo, name tag; a few looks of our own | Render job → MP4 download |
| VID-08 | Highlight reel (P2): choose clips + in/out by transcript selection, title/closing cards, music on/off (royalty-free bundled), export | Self-host: no credits; cloud: plan quota |

---

## 11. Display: widget studio (DISP)

### 11.1 Saved widgets
A widget is a stored config: `id`, `project_id`, `name`, `layout`, `source` (auto or manual selection), `filters`, `design`, `labels`, `connected_form_id` and `placement` (a hint such as home, pricing or checkout).

The embed points at the widget ID: `<script src=".../widget.js" data-widget="w_123">`. The existing `data-project` URL-param mode keeps working.

### 11.2 Layouts (all our own designs)
| Tier | Layouts |
|---|---|
| P0 | Masonry grid (exists), List (exists), Carousel (one at a time), Multi-card slider, Marquee (1–3 rows, speed), Single featured, Rating badge (avg ★ + count, links to wall), Floating toast (corner, delay, cycle, hide on mobile, dismiss per session) |
| P1 | Avatar stack ("loved by 120+" with faces), Company logo strip, Video gallery, Single video embed, Image gallery, Quote hero (big highlight), Popup modal list |

### 11.3 Builder UI
- **Left rail:** Layout (thumbnail picker; can switch at any time) · Testimonials · Design · Settings · Labels · Share.
- **Centre:** live preview with desktop/tablet/mobile toggles and a light/dark background swatch.

| ID | Requirement | AC |
|---|---|---|
| DISP-01 | Testimonial selection: **Auto** (all approved matching filters; new ones appear automatically) or **Manual** (pick list) + drag order + pin to top | Both modes; manual list survives filter changes |
| DISP-02 | Filters: tags (any/all), min rating, sources, type (text/video/image), keywords (include/exclude), language, form, max items, sort (newest, oldest, rating, random, manual) | Applied server-side in feed |
| DISP-03 | Design: font, text/title/date/star/card/border/background colours (transparent allowed), card radius, shadow, spacing, max width, theme light/dark/auto, toggles: rating, source icon (clickable to source URL), avatar or initials, Gravatar fallback, title/company, date (absolute/relative/hidden), images, video, highlights, read-more with char limit, first name only, "verified" badge for form-collected | Every toggle reflected in preview + embed |
| DISP-04 | Layout-specific: arrows/dots, autoplay delay/speed, cards per view, marquee rows/speed/direction, toast position/delay/duration | |
| DISP-05 | Labels + language: edit "Read more/less", "reviews", "out of", "Leave a testimonial"; auto-translate to visitor language if translations exist (P1) | |
| DISP-06 | Connected form CTA ("Leave a testimonial" link/button) | Opens hosted form or inline popup form |
| DISP-07 | Aggregate header: show total count + average (all or filtered) | |
| DISP-08 | Custom CSS (P1), scoped to the widget's shadow root | |
| DISP-09 | Share/Embed panel: script snippet, iframe snippet, hosted link (`/w/<id>`), React component (`@plaudit/react` `<PlauditWidget id>`), "email to my developer", platform guides (WordPress, Webflow, Framer, Wix, Squarespace, Shopify, Ghost, Notion via link, Next.js) | Each snippet copy-pasted into a test page renders |
| DISP-10 | **SEO mode** (our advantage): `widget.js` option `data-seo="ssr"` or a server-rendered HTML include endpoint (`/api/widget/<id>.html`) so review text exists in host DOM, plus optional JSON-LD | Text visible with JS disabled for the HTML include |
| DISP-11 | Performance budget: widget.js ≤ 15 KB gz, first render ≤ 300 ms on 4G, lazy images/video, `loading=lazy` option | Lighthouse check in CI |
| DISP-12 | Widget list: thumbnail, name, layout, created, views/visitors/clicks (range), install status, actions edit/embed/duplicate/delete; sort by metrics | |
| DISP-13 | Install detection (P1): widget.js pings `/api/widget/<id>/seen` (origin, path, daily) → "Live on example.com/pricing"; "removed" alert if no ping for 7 days after being live | Alerts in-app + email |
| DISP-14 | Widget analytics (P1): views, unique visitors (cookieless), clicks (read more, source link, CTA, video play), top pages, compare to previous period, **no 30-day limit** | Charts on widget page |
| DISP-15 | Starter widgets auto-created (ONB-04) and a "recommended for this page" hint from `placement` | |

---

## 12. Wall of Love and public pages (WALL)

| ID | Requirement | AC |
|---|---|---|
| WALL-01 | Multiple walls per project (`/wall/<project>/<slug>`, keep `/wall/[slug]`) with editor: themes (3–6 of our own), hero (title, subtitle, colours, featured testimonial, show total + avg), hero CTA (text, URL, colours), header nav links (≤4), logo + link, cover image, font, card colours, columns, infinite scroll or "load more", toggles as DISP-03 | Draft/public switch; preview mobile/desktop |
| WALL-02 | Filter tabs (by tag) incl. default tab; inline CTA block after N cards | |
| WALL-03 | SEO: title, meta description, OG image (auto-generated collage), canonical, `noindex` toggle, server-rendered HTML + JSON-LD `Review`/`AggregateRating` | Validates in Google Rich Results test |
| WALL-04 | Single testimonial page `/t/<id>` (P1): quote/video, person, CTA, OG image of the quote, share buttons; only for approved + consent | 404 otherwise (keep media rules) |
| WALL-05 | Wall analytics: views, visitors, CTA clicks, link clicks | |
| WALL-06 | Custom domain (cloud P1): CNAME + TXT verify + auto-TLS; covers walls, forms, booster | Root domain allowed via ALIAS note |
| WALL-07 | Custom favicon + custom `<head>` code (with CSP warning) | |

---

## 13. SEO / rich snippets (SEO), P0

| ID | Requirement | AC |
|---|---|---|
| SEO-01 | Snippet generator page: pick scope (all / tags / form), schema type (Product, Organization, LocalBusiness, SoftwareApplication, Course), name, URL → copy `<script type="application/ld+json">` **static** (paste) or **dynamic** (`<script src=".../schema/<id>.js">` that injects) | Valid JSON-LD with `aggregateRating` + up to 10 `review` |
| SEO-02 | Guidance on the page: needs ≥ 5 reviews, not on homepage, Google decides; preview mock of a result | |
| SEO-03 | Server-rendered JSON-LD on walls and `/t/` pages automatically | |
| SEO-04 | Renders analytics for dynamic snippet | |

---

## 14. Share assets: image studio and case studies (SHARE), P1 / P2

| ID | Requirement | AC |
|---|---|---|
| SHARE-01 | "Create image" from any testimonial or from Studio: 12+ templates of our own (1, 3, 6 testimonials), content override (doesn't change source), highlight colour, background (solid, gradient, pattern, upload, transparent), logo + position/size, theme, aspect presets (1:1, 4:5, 9:16, 16:9, LinkedIn, X, email banner 600×200) + custom W×H, export PNG/JPEG/ZIP, copy to clipboard | Rendered server-side (satori/resvg) so output is identical everywhere |
| SHARE-02 | Save as my template; brand kit presets (logo, colours, fonts) reused across forms/widgets/walls/images | |
| SHARE-03 | Social intents: post to X/LinkedIn with image + link (download + open intent) | |
| SHARE-04 | Case study (P2, AI optional): from a testimonial generate title, challenge/solution/result, pull quote, metrics; editor; public page + PDF | Works without AI as a template the owner fills |

---

## 15. Analytics (AN), P1

- **Dashboard (`/admin/analytics`):** a date range with previous-period comparison. Tiles: new testimonials (by source), approval backlog, average rating, widget views, visitors and clicks, form views and completions, wall views and CTA clicks, booster clicks, snippet renders, invite funnel.
- **Tables:** widgets, forms and walls, each sortable by its metrics.
- **Privacy:** no cookies and no third-party scripts. Visitor = a daily-rotating salted hash of IP + user agent, never stored raw (the same approach as Plausible). Data is aggregated per day. A self-host switch turns all analytics off.
- **Data model:** `analytics_events` (raw, kept for 30 days) plus `analytics_daily` (aggregated, kept forever).

---

## 16. Notifications and integrations (INT)

| ID | Requirement | AC |
|---|---|---|
| INT-01 (P0) | Owner/team email notifications per member: new testimonial (instant / daily digest), pending reminder weekly, auto-import summary, widget removed, monthly report | Settings per member |
| INT-02 (P0) | Chat notifications: Slack (incoming webhook URL or OAuth app), Discord webhook, Microsoft Teams webhook, Telegram bot; per form choose channel; message includes quote, rating, approve link | Test button |
| INT-03 (P1) | Zapier/Make/n8n: publish n8n + Make templates and a Zapier app using existing API + webhooks (triggers: testimonial created/approved, feedback received; actions: create testimonial, send invite, approve/tag) | Listed in each marketplace |
| INT-04 (P1) | **MCP server** (`/mcp`, OAuth or API key): tools list_testimonials, search, get, create_invite, get_embed_codes, summarize | Works in Claude Desktop & ChatGPT connectors |
| INT-05 (P1) | WordPress plugin: connect via API key, block + shortcode `[plaudit widget="…"]`, page-builder elements, site-wide toast, cache-plugin exclusions | WP.org submission |
| INT-06 (P1) | `@plaudit/react` npm package (`PlauditWidget`, `PlauditForm`, SSR-friendly) | |
| INT-07 (P2) | Stripe: auto-collect trigger (REQ-07), sales popup widget (verified purchases), thank-you coupons | |
| INT-08 (P2) | Social draft on approve (Buffer/Typefully via Zapier template) | |
| EXT-01 (P2) | Browser extension (Chrome and Firefox, Manifest V3): save a selection, or an X or LinkedIn post with its author, to the inbox as Pending through `/api/v1` | A selection saved from a page is in the inbox |

---

## 17. Team, workspaces, settings, cloud edition (TEAM / CLOUD)

| ID | Requirement | AC |
|---|---|---|
| TEAM-01 (P1) | Roles: Owner, Admin, Editor (content, no team/billing), Viewer (read + share approved), per-project access list | Server-enforced on every route |
| TEAM-02 (P1) | Audit log (who approved/edited/deleted/exported) | Filterable |
| TEAM-03 (P1) | Generic OIDC (Okta, Microsoft, Authentik) via discovery; SAML (P2) | |
| TEAM-04 (P0) | Project settings page: name, slug (change with redirects), website, brand (logo, colours, fonts = brand kit), tags manager (rename/merge/delete), danger zone (delete project with typed confirm + export first) | Fixes current "no delete / no slug change" gap |
| TEAM-05 (P0) | Storage drivers: local (default) + S3-compatible (R2/MinIO) with presigned uploads | Env-switchable; migration command |
| TEAM-06 (P1) | Postgres support (`DATABASE_URL`) alongside SQLite | Same migrations |
| CLOUD-01 (P0 cloud) | Plans + Stripe billing: Free (e.g. 25 testimonials, 1 form, all widget layouts, branding badge), Starter, Pro, Agency (white-label, client workspaces, custom domains); 7-day trial; usage meters; upgrade prompts at limits (never hide content already collected: Senja hides extras over the cap, Plaudit shows them read-only) | Webhook-driven entitlements |
| CLOUD-02 | "Powered by Plaudit" badge on free cloud, removable on paid; affiliate link in badge for paid users | |
| CLOUD-03 | Agency: client workspaces, client-view role, white-label domain + logo on admin login, one invoice | P1 |

---

## 18. Data model changes (Drizzle, additive migrations)

New tables. Columns are the minimum; everything also has `id`, `created_at` and `updated_at`.

- **Collection**
  - `forms`: project_id, slug, name, status (live/paused), pages JSON, design JSON, labels JSON, settings JSON (auto-approve rule, tags, notify, webhook), reward JSON, language.
  - `answers`: testimonial_id, question_key, text, video_key + media fields (moved from testimonials for non-primary answers), order.
  - `customers`: project_id, email, name, avatar_key, company, title, website, socials JSON, custom JSON.
  - `feedback`: project_id, form_id, customer_id, rating, text, source (low-rating/private-question).
- **Testimonial extras**
  - `testimonial_images`: testimonial_id, key, alt, order.
  - `translations`: testimonial_id, lang, title, text, tagline, machine bool.
  - `highlights`: testimonial_id, answer_id, start, end.
  - `testimonial_history`: testimonial_id, actor, diff JSON.
- **Display**
  - `widgets`: project_id, name, layout, selection_mode, manual_ids JSON, filters JSON, design JSON, labels JSON, connected_form_id, placement, last_seen_at, last_seen_origin.
  - `walls`: project_id, slug, name, published bool, theme, config JSON, domain_id.
  - `boosters`: project_id, slug, links JSON, design JSON, published.
- **Import**
  - `import_sources`: project_id, source, identifier, options JSON, auto_sync bool, interval_h, last_run_at, last_status, failures.
- **Outreach and rewards**
  - `campaigns`: project_id, form_id, name, sender, subject, body, button_text, reminders JSON, rtl, status.
  - `campaign_recipients`: extends today's `requests` (add campaign_id, opened_at, clicked_at, started_at, declined_at, custom JSON).
  - `reward_codes`: form_id, code, claimed_by_testimonial_id, claimed_at.
- **Analytics, notifications and domains**
  - `analytics_events` and `analytics_daily`: object_type, object_id, metric, date, count, uniques.
  - `notification_channels`: project_id, type (email/slack/discord/teams/telegram), target, events JSON.
  - `domains`: project_id, hostname, verify_token, status, tls_status.
- **Cloud only:** `audit_log` (actor, action, object, meta) and `plans`/`subscriptions`.

Changes to `testimonials`:
- **Add:** form_id, customer_id, title, source_url, source_review_id (unique with project + source), source_date, date_precision, language, status `hidden` and `trashed` (trashed_at), is_featured/pin_order, custom_fields JSON, hidden_fields JSON, reward_code_id.
- **Keep:** all consent columns.

Migration: create a default form per project from the current project settings (prompt, questions, consent, max video, allow text/video), and copy the per-project auto-approve value into that form's settings.

---

## 19. API and webhooks (API)

- `/api/v1` gets CRUD for forms, widgets, walls, campaigns, invites (`POST /invites`), customers, feedback, import (`POST /imports` → job ID, `GET /imports/{id}`), tags, and analytics read.
- Video upload through the API: the resumable upload session already used by the form, exposed with an API key.
- **Scoped API keys:** per project, plus a read-only public key for client-side feeds.
- **New webhook events:**
  - `testimonial.updated`, `testimonial.hidden`, `testimonial.trashed`, `testimonial.restored`
  - `feedback.created`
  - `form.submitted` (raw, includes custom and hidden fields)
  - `invite.sent`, `invite.opened`, `invite.clicked`, `invite.declined`
  - `import.completed`
  - `widget.installed`, `widget.removed`
- **Webhook behaviour:** keep the HMAC signatures and retries. Allow editing a webhook's URL and events in the UI (missing today). Block private-IP targets in cloud mode.
- **OpenAPI:** update `openapi.json` with every endpoint and publish typed SDKs (TS first).

---

## 20. Non-functional requirements

- **Privacy and GDPR**
  - Keep the consent ledger.
  - Add a per-reviewer "download my data" and "delete my data" page, linked from the withdraw page.
  - Add retention settings per project (auto-delete rejected items after N days).
  - Write a DPA template and a list of sub-processors for the cloud edition.
  - No third-party trackers anywhere public. Fonts are self-hosted.
- **Accessibility:** forms, widgets and walls meet WCAG 2.2 AA. Captions are on by default (already the case). Widgets work fully with the keyboard, carousels respect `prefers-reduced-motion`, and colour-contrast checks warn in the builder.
- **Performance:** widget.js ≤ 15 KB gz. Public pages ≤ 100 KB before media. Feeds are cached at the CDN (`s-maxage=60, swr=300`, as today).
- **Security:**
  - CSP on admin (exists).
  - Every public form gets a rate limit plus a honeypot, with optional Turnstile/hCaptcha.
  - Uploads are sniffed (exists). SVG is never accepted.
  - Custom code and CSS are sanitised. Owner-supplied HTML never runs inside admin.
- **i18n:** admin UI string catalog. English ships first; collection forms and widgets get 10+ locales at P0/P1.
- **Scale:** the in-process worker and in-memory rate limiter stay the default for self-host. Cloud mode moves to Redis or Postgres (job queue and limiter), and supports multiple instances.
- **Testing:**
  - Every requirement ID gets at least one Playwright e2e test in `qa/`, run in Chrome and WebKit, plus a test on a real iPhone (Safari).
  - Visual regression snapshots for each widget layout.
  - Import adapters run against recorded fixtures.

---

## 21. Release plan

Each phase ships behind feature flags and can be merged on its own.

### Phase 1: "Parity core" (P0). Goal: a Senja/Shapo user finds nothing basic missing. About 6–8 weeks of agent work.
1. **Data foundations:** forms, answers, customers and widgets tables. Migration from per-project settings. Project delete and slug change (TEAM-04). S3 storage driver (TEAM-05).
2. **Form builder v2:** FORM-01 to FORM-11, FORM-16, FORM-18 (templates). Auto-approve moves into per-form settings.
3. **Inbox v2:** INBOX-01 to INBOX-09 and INBOX-15. Manual add (IMP §8.1).
4. **Widget studio:** DISP-01 to DISP-07, DISP-09 to DISP-12, DISP-15, with the 8 P0 layouts.
5. **Wall editor:** WALL-01 to WALL-03. SEO snippet: SEO-01 to SEO-03.
6. **Importers:** framework plus the 8 P0 sources and the 3 migrations (IMP-01, IMP-03, IMP-05).
7. **Notifications:** INT-01 and INT-02. Onboarding: ONB-01 and ONB-03 to ONB-06.
8. **Cloud only:** CLOUD-01 and CLOUD-02.

### Phase 2: "Growth" (P1). About 6 weeks.
- Campaigns and auto-collect (REQ-01 to REQ-08). Booster and QR (BOOST).
- Rewards (FORM-13). Low-rating branch (FORM-12). Form analytics. Draft autosave.
- Auto-sync and the remaining importers. XLSX import.
- Video trim and poster (VID-01 to VID-04).
- Install detection, widget analytics and the analytics dashboard (DISP-13, DISP-14, AN).
- Translations and AI search (bring your own provider).
- Image studio and the single testimonial page.
- Roles, audit log and OIDC.
- WordPress plugin, React package, MCP server, Zapier/Make/n8n.
- Custom domains and the agency tier.

### Phase 3: "Beyond" (P2)
- Multiclip, HLS, social clip renderer and highlight reels.
- AI case studies. Voice of Customer reports. NPS and AI surveys.
- Stripe sales popup and thank-you gifts. Browser extension. Screenshot OCR import.
- Owner welcome and thank-you videos.

**Definition of done (every item)**
- The acceptance criteria pass in an e2e test.
- Docs are updated: README, `docs/API.md`, and a help page.
- The empty state and error states have been designed.
- Mobile works down to 360 px.
- No new third-party request appears on public pages.

---

## 22. Deliberately not copying, and how we differ

- **No review gating on public platforms.** The low-rating branch is opt-in and only for private testimonials.
- **No hiding of collected content behind caps.** Senja hides testimonials over the free limit. Plaudit keeps them visible but read-only.
- **No credit-metered AI on self-host.** It runs on the user's own key or a local model.
- **Every question can be optional, and every answer is editable** (Senja's gaps).
- **Trash, undo and history** (neither competitor has them).
- **Unique reward codes and claim tracking** (Senja's gap).
- **Signed, multi-event webhooks and a full-edit API** (both competitors' gaps).
- **Caption tracks and accessible players**, plus **SEO-visible embeds** (both competitors' gaps).
- **Open source, self-hostable, with data export/import between instances.**

## 23. Open questions for Suresh
1. **Cloud pricing tiers and free cap:** proposed Free 25 / Starter $19 / Pro $39 / Agency $99. They undercut the $29 competitors but need sanity-checking against video storage costs.
2. **Brand-scrape LLM:** which provider should the cloud edition use for the brand scrape and testimonial discovery (ONB-02/03), or should it be heuristics only?
3. **Google Places API key:** do we supply the key in cloud (a cost per import), or require users to bring their own?
4. **Phase 1 scope for cloud:** does Phase 1 ship cloud billing, or self-host only first?
5. **Locales:** which 10 locales come first? English and Tamil/Hindi for the user's audience, then EU languages?

---

## Appendix A: Competitor screen references (local only)
`plaudit-review/competitor-screens/INDEX.md` lists every captured screen. Key ones per module:
- **Onboarding:** Senja 01–09; Shapo 01–10.
- **Form builder:** Senja 11–22 (reward, page cards, design, settings, invite step); Shapo 26–35.
- **Customer form flow:** Senja 23–33; Shapo 36–39.
- **Inbox:** Senja 34–41; Shapo 11–17, 53.
- **Import:** Senja 42–49; Shapo 02–06.
- **Widgets:** Senja 53–59; Shapo 18–24, 54.
- **Walls:** Senja 60–62; Shapo 40–41.
- **SEO, booster, surveys, campaigns, analytics:** Senja 64, 76–77; Shapo 42–48.
- **Studio assets:** Senja 63–73.
- **Settings and integrations:** Senja 78–89; Shapo 49–52.

## Appendix B: Competitor route maps (for completeness checks)
- **Senja** (SvelteKit):
  - **Sidebar app:** welcome, forms, import (auto/web/spreadsheet/manual/migrate), proof (inbox), feedback, thank-yous, studio (+saved), proof-reels, sales-widget, analyze, customers, outreach, automate, auto-collect, yappometer, settings (billing, brand-kit, tags, domain, members, notifications, powered-by, integrate, danger).
  - **Blank layout:** forms/[slug] editor, studio widget/wall/image/video/sales-widget, case-studies, multiclip, ai-studio/video, magic-video, mcp-consent, checkout.
  - **Public:** senja.io/p/<project>/r/<form>, /p/<project>/<wall>, /t/<id>.
- **Shapo** (Next.js):
  - **Workspace:** get-started, testimonials, analytics, widgets(+analytics), wall-of-love, google-review-schema, forms(+analytics), review-booster, surveys, campaigns, settings(members, integrations), billing, tools, affiliates.
  - **Public:** /forms/<id>, /widgets/<id>, /wall-of-love/<id>, /booster/<id>, /surveys/<id>, /video/<id>.
  - **Connect:** /connect/wix, /connect/wordpress.
  - **Free tools:** 7 tools.
