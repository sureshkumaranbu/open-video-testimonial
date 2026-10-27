# Plaudit build status

The one place that says what is built, what is left and what comes next. Update it at the end of every milestone.

- **What we're building:** [PRD-v1-parity.md](PRD-v1-parity.md) (requirement IDs such as FORM-03).
- **How Phase 1 was built:** [v1-implementation-plan.md](v1-implementation-plan.md) (milestones M1–M7, decisions D1–D24).
- **Is every requirement tested?** `node scripts/req-coverage.mjs --all` checks that every Phase 1 ID appears in a test title.

Last updated: 2026-10-27.

## Where things are

| Item | State |
|---|---|
| `main` | Phase 1 merged through [#14](https://github.com/sureshkumaranbu/open-video-testimonial/pull/14) on 2026-10-27 (5a1758c) |
| Current branch | `plaudit/m8-closeout` (M8), PR against `main` |
| Tests | 780 unit tests pass (6 MinIO tests run only in CI). Locally: Chromium e2e green apart from 4 recorder tests that timed out under load and passed on a rerun, and WebKit e2e 143 passed. Requirement coverage: 54 of 54. |
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
| L12 | Five foreign keys from before Phase 1 have no index (`testimonial_tags.tag_id` matters most: the tag-rename trigger scans it) | Allow-listed in the index test | — |
| L13 | The recorder e2e tests can time out when the whole suite runs on a busy machine | Flaky locally, passes alone | — |

## Phase 2: "Growth" (P1). In progress.

Proposed order. Each milestone is one branch, one agent, then one review, to keep the token cost down.

| Milestone | Scope | PRD IDs | Status |
|---|---|---|---|
| M8 Phase 1 close-out | L4–L8 above, plus the real Senja export (L2) | INBOX-08, FORM-14 | Built and reviewed; PR open |
| M9 Campaigns and auto-collect | Email campaigns with recipients from CSV or customers, preview and test send, per-recipient tracking, decline link, `POST /api/v1/invites` and an incoming webhook, invite webhooks | REQ-01..07 | Next |
| M10 Review booster, rewards, low-rating branch | Link page for Google and other review sites, Google review link helper, QR codes, link clicks; rewards and unique codes; opt-in private feedback for low ratings | BOOST-01..05, FORM-12, FORM-13, REQ-08 | Planned |
| M11 Analytics | Install detection, widget and wall analytics, form analytics, snippet analytics, the `/admin/analytics` dashboard (cookieless) | DISP-13, DISP-14, FORM-15, WALL-05, SEO-04, AN | Planned |
| M12 Video and sharing | Trim, poster frame, replace and download video; single testimonial page; image studio and social share; custom CSS | VID-01..04, WALL-04, SHARE-01..03, DISP-08 | Planned |
| M13 Import and inbox growth | Auto-sync, XLSX and paste import, the remaining importers; duplicates and merge, customer records, translations, AI search (your own provider) | IMP-02, IMP-04, INBOX-11..14 | Planned |
| M14 Team, API and integrations | Roles, audit log, generic OIDC; API CRUD for forms, widgets, walls and campaigns; Zapier, Make and n8n, MCP server, WordPress plugin, React package | TEAM-01..03, API §19, INT-03..06 | Planned |
| Cloud (separate repo) | Billing, badge, agency workspaces, custom domains, plan limits | CLOUD-01..03, WALL-06, IMP-06 | Not in this repo |

## Phase 3: "Beyond" (P2). Not started.

Multiclip, HLS, social clips and highlight reels (VID-05..08). AI case studies (SHARE-04). Voice of Customer reports, NPS and AI surveys. Stripe sales popup and thank-you gifts (INT-07). Browser extension. Screenshot OCR import. Owner welcome videos (FORM-17). Postgres (TEAM-06).

## Open decisions for Suresh

1. Cloud pricing tiers and free cap (PRD Q1).
2. Which AI provider, if any, for the brand scrape and discovery (PRD Q2).
3. Google Places key: bring your own on self-host is assumed (PRD Q3).
4. Which locales get native review first (PRD Q5).
5. Whether the classic `/c` form retires in Phase 2 (plan §10.5).
