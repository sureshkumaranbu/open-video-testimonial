# Plaudit build status

The one place that says what is built, what is left and what comes next. Update it at the end of every milestone.

- **What we're building:** [PRD-v1-parity.md](PRD-v1-parity.md) (requirement IDs such as FORM-03).
- **How Phase 1 was built:** [v1-implementation-plan.md](v1-implementation-plan.md) (milestones M1–M7, decisions D1–D24).
- **Is every requirement tested?** `node scripts/req-coverage.mjs --all` checks that every Phase 1 ID appears in a test title.

Last updated: 2026-10-28 (after M14).

## Where things are

| Item | State |
|---|---|
| `main` | Phase 1 (#14), M8 ([#15](https://github.com/sureshkumaranbu/open-video-testimonial/pull/15), b5648a6), M9 ([#16](https://github.com/sureshkumaranbu/open-video-testimonial/pull/16), 68977c5), M10 ([#17](https://github.com/sureshkumaranbu/open-video-testimonial/pull/17), 1927357) M11 ([#18](https://github.com/sureshkumaranbu/open-video-testimonial/pull/18), 2f846b5) M12 ([#19](https://github.com/sureshkumaranbu/open-video-testimonial/pull/19), 7c8d12d) M13 ([#20](https://github.com/sureshkumaranbu/open-video-testimonial/pull/20), 6b449b6) and M14 ([#21](https://github.com/sureshkumaranbu/open-video-testimonial/pull/21)), merged on 2026-10-27 and 2026-10-28 |
| Open PRs | None |
| Tests | 1,049 unit tests pass on the M14 branch (6 MinIO tests run only in CI). Chromium e2e in the cloud session: 213 of 215 passed, then the audit-log test passed again once it stopped matching another spec's row; the other failure is L17. Requirement coverage: 100 of 100 (Phase 1 and M9–M14). Chromium e2e runs in the cloud session use a newer Chromium than Playwright pins, so one recorder check fails there (L17); CI runs the pinned Chromium and WebKit. |
| Local demo | `plaudit-v1-demo` in `Development/.claude/launch.json`, http://127.0.0.1:3300 |

## Phase 1: "Parity core" (P0). Done.

| Milestone | What it added | PRD IDs | Last commit |
|---|---|---|---|
| M1 Foundations | All Phase 1 schema (0009, 0010 FTS5), project delete and slug change, brand kit, tags manager, S3 storage, admin UI kit | TEAM-04, TEAM-05 | 20451c3 |
| M2 Forms | Many forms per project, step-by-step engine, builder with live preview, custom and hidden fields, 11 locales with RTL, per-form rules, share panel with QR, templates | FORM-01..11, 16, 18 | 5eb25fb |
| M3 Inbox | Status tabs, search, filters, sort, pages, bulk actions, drawer editor, highlights, trash, history, filtered export, manual add | INBOX-01..10, 15 | f1ffaab |
| M4 Widgets | Saved widgets, 8 layouts, live builder, form CTA, rating summary, SEO HTML include, size budget | DISP-01..07, 09..12, 15 | 95094ce |
| M5 Walls and SEO | Many walls with an editor, tag tabs, inline CTA, meta tags, OG image, JSON-LD, snippet generator | WALL-01..03, SEO-01..03 | d18c835 |
| M6 Importers | Import flow with preview, 8 review sites, Testimonial.to, Senja and Shapo migrations, dedupe, month-only dates | IMP-01, 03, 05 | 402cb4a |
| M7 Notifications and onboarding | Email per member (instant, digest, weekly), Slack, Discord, Teams and Telegram, webhook editing, wizard, testimonial discovery, starter assets, checklist, empty states | INT-01, 02, ONB-01, 03..06 | 3b77394 |
| After M7 | Onboarding finds Tailwind-style testimonial cards and skips white or black theme colours; fixed a widget bug that broke a page with several widgets (the CI failure) | ONB-03, ONB-04, DISP-04 | f572b70 |

### Left over from Phase 1

These are either partly done or need something from Suresh.

| # | Item | State | Needs |
|---|---|---|---|
| L1 | Merge PR #14 into `main` | **Done** 2026-10-27 | — |
| L2 | Check the migrations against real files | **Senja done** (a real export showed job titles and headlines were mapped wrongly; fixed in M8). **Shapo** has no export button, so its importer uses the API and was checked against Shapo's API docs. Testimonial.to, Google Play and Product Hunt are still checked only against our own fixtures | A Shapo API key test run, if you want one; a Testimonial.to export |
| L3 | 10 non-English form languages are our own wording | Shipped, marked "needs native review" | A native speaker (Tamil and Hindi first) |
| L4 | Change a testimonial's photo and company logo in the inbox (INBOX-08) | **Done** in M8 | — |
| L5 | Contrast warnings in the form builder, widget studio, wall editor and brand kit; automatic text colours pick the readable one | **Done** in M8. Visible change: button text on some mid-tone colours flips from white to dark, and the Sunrise wall theme's button is a deeper orange | — |
| L6 | Draft autosave on step-by-step forms (FORM-14): kept in the visitor's browser for 7 days; videos and consent are never saved | **Done** in M8 | — |
| L7 | Indexes on the foreign keys Phase 1 added (migration 0011), plus a test that fails when a new foreign key has no index | **Done** in M8 | — |
| L8 | WebKit (Safari) e2e and MinIO S3 tests in CI | **Done** in M8. It found that every admin dialog was invisible in Safari, which is fixed | — |
| L9 | Direct-to-S3 uploads (decision D16 relays uploads through the server for now) | Deferred to Phase 2 | — |
| L10 | Brand scrape (ONB-02): colour and logo from the site work by heuristics; the background job and any AI step are open | Partly done | Decision on an AI provider (PRD Q2) |
| L11 | Cloud billing and the "Powered by" badge (CLOUD-01, CLOUD-02) | Not in this repo | Belongs to the cloud edition |
| L12 | Five foreign keys from before Phase 1 had no index (`testimonial_tags.tag_id` mattered most: the tag-rename trigger scans it) | **Done** in M13 (migration 0016); the index test's allow-list is empty | — |
| L13 | The recorder e2e tests can time out when the whole suite runs on a busy machine | Flaky locally, passes alone | — |
| L14 | Zip export/import didn't include campaigns, boosters, booster clicks or reward codes (campaign recipients came across as ordinary requests) | **Done** in M13, with the M13 tables too. Imported synced sources and active campaigns arrive paused, campaign webhook tokens aren't exported, and smart-search vectors are rebuilt rather than exported | — |
| L15 | QR codes with a logo in the centre haven't been scanned with a real phone; Google Places search is tested only against a mock | Unverified | A phone scan; a Places API key if you want business search |
| L16 | No `/api/v1` endpoint for reading analytics yet | Not built (fits M14's API work) | — |
| L17 | One recorder e2e check (`the dashboard shows conversion progress, then the poster`) expects the browser to skip the H.264 MP4 and play the WebM. Newer Chromium builds play H.264, so it fails with them; it passes with the Chromium that Playwright pins (CI) | Environment-dependent | — |
| L18 | Private media addresses (`/api/media/…` for files that aren't public) aren't checked against a limited member's or key's projects. The addresses are random and only handed out inside projects the person can open, but it isn't enforced | Open (TEAM-01 follow-up) | — |
| L19 | `GET /api/admin/jobs/<id>` (an import's progress) isn't checked against the job's project; it shows only the job's type, status and error | Open (TEAM-01 follow-up) | — |
| L20 | The WordPress plugin, the Zapier app, the n8n and Make templates and `@plaudit/react` are built and tested here but not published, and OAuth for MCP hasn't been tried with the real Claude.ai or ChatGPT connectors | Needs accounts | Your WordPress.org, Zapier, Make, n8n and npm accounts (and the `@plaudit` npm scope) |

## Phase 2: "Growth" (P1). Done in this repo (M8–M14); the cloud items stay in the cloud repo.

Proposed order. Each milestone is one branch, one agent, then one review, to keep the token cost down.

| Milestone | Scope | PRD IDs | Status |
|---|---|---|---|
| M8 Phase 1 close-out | L4–L8 above, plus the real Senja export (L2) | INBOX-08, FORM-14 | **Merged** (#15) |
| M9 Campaigns and auto-collect | Email campaigns with recipients from CSV or customers, preview and test send, per-recipient tracking, decline link, `POST /api/v1/invites` and an incoming webhook, invite webhooks | REQ-01..07 | **Merged** (#16). Decisions: native Stripe/Shopify triggers moved to M14; open tracking is opt-in per campaign; "No thanks" asks for one confirming click (mail scanners open every link); unsubscribe now covers the whole project; the webhook is capped at 120 a minute and 2,000 a day |
| M10 Review booster, rewards, low-rating branch | Link page for Google and other review sites, Google review link helper, QR codes, link clicks; rewards and unique codes; opt-in private feedback for low ratings | BOOST-01..05, FORM-12, FORM-13, REQ-08 | **Merged** (#17). Booster pages live at `/b/<project>/<booster>` as plain HTML with no scripts (under 50 KB); renamed boosters keep old links and QR codes working. Rewards never depend on the rating (a 1-star feedback gets the same reward, FTC/Google rules); booster links never carry a reward. Reward codes are claimed atomically, and the wheel is spun on the server. Rewards and the low-rating branch need a step-by-step form |
| M11 Analytics | Install detection, widget and wall analytics, form analytics, snippet analytics, the `/admin/analytics` dashboard (cookieless) | DISP-13, DISP-14, FORM-15, WALL-05, SEO-04, AN-01 | **Merged** (#18). No cookies: a visitor is a hash of IP + browser + project with a random salt that changes daily and is deleted after 2 days; paths never keep query strings; raw events kept 30 days, daily totals forever; `ANALYTICS=off` turns it all off. widget.js stays under budget (core 7,147 B gzipped). "Removed" alerts come from an hourly job, so they can be up to an hour late |
| M12 Video and sharing | Trim, poster frame, replace and download video; single testimonial page; image studio and social share; custom CSS; safe wall head options | VID-01..04, WALL-04, SHARE-01..03, DISP-08, WALL-07 | **Merged** (#19). Trims are non-destructive: the original is kept but never public while a trim is set, and captions follow the cut. ffmpeg times are built only from whole, non-negative milliseconds. Downloads are owner-only and `private, no-store`. `/t/<id>`, its image and its beacon answer 404 unless approved, not withdrawn and publicly consented. Custom CSS is cleaned on save and again on the way out: no `<`, comments, escapes, `@import` (removed until none is left), `image()`/`image-set()`/`src()`, or `url()` outside this server. WALL-07 has no raw HTML: a favicon, Plausible or GA4, and verification codes; the wall's CSP adds only that provider's hosts, only on that wall. widget.js core is 7,157 B gzipped |
| M13 Import and inbox growth | Auto-sync, XLSX and paste import, the remaining importers; duplicates and merge, customer records, translations, AI search (your own provider); also L12 and L14 | IMP-02, IMP-04, INBOX-11..14 | **Merged** (#20). Flags `imports2`, `customers`, `translations`, `aisearch`. 22 more sources: official APIs or feeds where they exist (YouTube, Reddit, WooCommerce, Etsy, WordPress.org, Apple Podcasts, Feefo), page data (Shopify review apps, Clutch, AppSumo, Udemy), and a saved copy of the page for sites that need a login or block fetching (Yelp, Facebook, LinkedIn, Tripadvisor, Amazon, Fiverr, Airbnb, Zillow, Realtor.com, Chrome Web Store, Trustindex); all checked against our own fixtures only. Auto-sync runs every 12 or 24 h through the normal import job (so no duplicates) and emails after 3 failures in a row, using the import-summary email setting. The .xlsx reader is our own (no new dependency), with caps on size, inflate ratio, cell and total text, rows and columns. Merge copies B onto A and trashes B; restoring B brings it back as Pending; B's images stay owner-only on A unless B was public with at least A's consent. Customers without an email get one record per review (never matched on name). Translation and smart-search calls go only to the provider you configure, from the server; widgets show stored translations only. Smart search falls back to keyword search and says why |
| M14 Team, API and integrations | Roles, audit log, generic OIDC; API CRUD for forms, widgets, walls, campaigns, tags, customers and feedback, and analytics read (L16); Zapier, Make and n8n, MCP server, WordPress plugin, React package; native Stripe and Shopify triggers for campaigns | TEAM-01..03, API-01, API-02, INT-03..06, REQ-07 | **Merged** (#21). Flags `team2`, `api2`, `mcp`. API-01 and API-02 are our IDs for PRD §19's CRUD and analytics read (the PRD gives §19 none). Roles are owner, admin, editor and viewer; editors and viewers can be limited to some projects, and admins always reach every project. Every dashboard route checks the role and the project it names (a guard-rails test fails any route without a guard). Editors may start and send campaigns; webhooks, API keys, MCP connections, notification channels, the team, new projects and the audit log stay admin-only. With `team2` off, everyone but the owner is an admin, as before. API keys can be made for one project; existing keys reach all. The audit log has filters and CSV export, no secrets or IPs, and is kept `AUDIT_RETENTION_DAYS` (365). Generic OIDC through discovery (`OIDC_*`): PKCE, public-key signatures only, `email_verified` required unless `OIDC_TRUST_EMAIL`. MCP at `/mcp` with an API key or OAuth 2.1 (dynamic registration, PKCE S256, rotating refresh tokens, revocable in Settings) so Claude.ai and ChatGPT connectors can connect. `POST/DELETE /api/v1/webhooks` for instant Zapier triggers (public addresses only, checked again on delivery). Stripe (`checkout.session.completed`, `invoice.paid`) and Shopify (`orders/fulfilled`) triggers check the provider's signature over the raw body, handle each delivery once, and invite after N days; the signing secret is never returned. Integrations live in `integrations/` and `packages/react` (L20) |
| Cloud (separate repo) | Billing, badge, agency workspaces, custom domains, plan limits | CLOUD-01..03, WALL-06, IMP-06 | Not in this repo |

## Phase 3: "Beyond" (P2). Not started.

Multiclip, HLS, social clips and highlight reels (VID-05..08). AI case studies (SHARE-04). Voice of Customer reports, NPS and AI surveys. Stripe sales popup and thank-you gifts (INT-07). Browser extension. Screenshot OCR import. Owner welcome videos (FORM-17). Postgres (TEAM-06).

## Open decisions for Suresh

1. Cloud pricing tiers and free cap (PRD Q1).
2. Which AI provider, if any, for the brand scrape and discovery (PRD Q2).
3. Google Places key: bring your own on self-host is assumed (PRD Q3).
4. Which locales get native review first (PRD Q5).
5. Whether the classic `/c` form retires in Phase 2 (plan §10.5).
6. Not a decision, a to-do: add the new settings to `.env.example` (agents never touch it). M13: `YOUTUBE_API_KEY`, `ETSY_API_KEY`, `TRANSLATE_PROVIDER`, `TRANSLATE_API_URL`, `TRANSLATE_API_KEY`, `TRANSLATE_MODEL`, `EMBEDDINGS_API_URL`, `EMBEDDINGS_API_KEY`, `EMBEDDINGS_MODEL`. M14: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_LABEL`, `OIDC_SCOPES`, `OIDC_EMAIL_DOMAINS`, `OIDC_TRUST_EMAIL`, `AUDIT_RETENTION_DAYS`.
7. Decisions made in M14 that you may want to revisit: OAuth for MCP connectors was built (bigger, but needed for Claude.ai and ChatGPT); editors may send campaigns; viewers may make share images and see analytics but need editor to download a video original; exports need editor.
