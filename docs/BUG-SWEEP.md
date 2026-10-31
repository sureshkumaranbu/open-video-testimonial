# Bug sweep (2026-10-30)

An audit of every user and admin workflow on `main` at 55c7f6b, run against a real built server and in the browser. One sweep agent tests and fixes; the reviewer (gate) re-checks each fix before it is closed.

**How to read this:**
- **Scenarios:** each row is one workflow, run end to end. Result is Pass, Fail (with a bug ID), Blocked (it needs something only a human has; see "Only a human can do these" in [STATUS.md](STATUS.md)) or Not run.
- **Bugs:** a bug goes Open → Fixed (with a commit and a test that failed before the fix) → Closed (the gate re-ran it). Won't fix needs a reason.
- Never put passwords, keys or secrets in this file.

## Setup

| Item | Value |
|---|---|
| Code | `main` at 55c7f6b, branch `plaudit/bug-sweep` |
| Server | Production build (`npm run build`, `npm start`), its own empty data folder, port 3310 |
| Sign-in | Email and password; Google, Apple and SSO through the local mock (`e2e/fixtures/mock-oidc.mjs`, port 3399) |
| Email | `MAIL_OUTBOX=true` (mail is read from the outbox, never sent) |
| Browsers | Chromium, WebKit, a phone-sized window |

## Scenarios

Roles: **Owner** (the first admin), **Team** (invited members, each role), **Visitor** (someone filling in a form, opening a wall, widget or share page), **API** (API key, webhooks, MCP, extension).

| ID | Area | Role | Scenario | Result | Bug | Notes |
|---|---|---|---|---|---|---|
| S-01 | ONB, Sign-in | Owner | First run: signed-out redirects, the sign-in page offers password, email link, Google, Apple and SSO; wrong password; the wizard with a site (finds 4, imports them, checklist 1/4), without a site and with a private address | Pass | | Password reset and change don't exist (the password comes from `ADMIN_PASSWORD`, AUTH.md) |
| S-02 | Sign-in | Owner | Google, Apple and SSO through the mock: the owner gets in, a stranger is refused with a reason; email link mailed; sign-out; login rate limit; a foreign Origin on an admin POST is refused | Pass | | |
| S-03 | Cross-cutting | All | Every admin page and the public pages, signed in and out, in Chromium, WebKit, a Pixel 7 and an iPhone 14 size: no script errors, no 5xx, no sideways scroll on the phone, the XSS testimonial never runs | Pass | | WebKit logs its own media-control "placard" messages; not the app |
| S-04 | Security | Visitor | Every `/api/admin` and `/api/v1` handler (278 requests) without a session or key: 401/403/404, never 2xx or 5xx | Pass | | |
| S-05 | TEAM | Team | Invite admin, editor and viewer (limited to one project) and an unlimited editor; the invite link signs in; SSO sign-in; a matrix of 18 actions per role on the API; pages per role; remove a member ends their session; audit log entries | Fail | B-01 | |
| S-06 | FORM | Visitor | Step-by-step form (8 steps) by text in Chromium, WebKit, Pixel 7 and iPhone 14; by video upload in Chromium and iPhone 14; the default form | Pass | | Recording on camera is covered by the e2e recorder specs (Chromium's fake camera) |
| S-07 | FORM, Security | Visitor | Validation and consent errors on the classic and form endpoints: no consent, no name, too long, bad rating, bad email, SVG and disguised files, honeypot, per-IP rate limit, unknown project or form, a paused form | Pass | | |
| S-08 | REQ | Owner, Visitor | Requests: create, send, the email's prefilled link, submit, marked responded, receipt with a withdraw link; unsubscribe page; a second request to an unsubscribed person is skipped | Pass | | |
| S-09 | REQ | Owner, Visitor | Campaign: paste recipients (invalid and duplicate lines skipped), test send, start, invitation in the outbox, decline page and button, the personal link, funnel counts; a broken `/r/` link | Fail | B-02 | |
| S-10 | DISP | Visitor | Every widget layout (grid, list, carousel, slider, marquee, featured, badge, toast, sales) and the old `data-project` snippet on a page from another origin with hostile CSS, script and iframe snippets, the form popup snippet; Chromium and iPhone 14 | Pass | | The XSS testimonial and an HTML-laden purchase render as text |
| S-11 | WALL, SEO | Visitor | Walls and `/t/` pages: JSON-LD and the SEO HTML include escape the XSS name; security headers; a testimonial page's heading | Fail | B-03 | |
| S-12 | BOOST | Owner, Visitor | Booster: `javascript:` links refused, publish with a review link and a form link, the page has no scripts, `/go/` redirects, unknown link 404, renamed booster keeps the old link (308), unpublished 404; Places search without a key | Pass | | |
| S-13 | Data | Owner | Export .zip from the data page, import it on the dashboard: same testimonials, forms, widgets, walls, boosters, campaigns and case studies; the video arrives processed | Pass | | |
| S-14 | Projects | Owner, Visitor | Delete a project (typed name): its collection page, forms, walls, embed, widget feeds and HTML, `/t/`, media, captions, booster and case study all 404; its files are removed; a key limited to it lists nothing | Pass | | |
| S-15 | Consent | Visitor | Withdraw through the receipt's link: the testimonial leaves its page, the case study and PDF, the widget feed and the wall; re-approving answers 409 | Pass | | |
| S-16 | SHARE-04 | Owner, Visitor | Case studies from the XSS testimonial and a normal one: publish, public page escapes the name, PDF is a real PDF | Pass | | |
| S-17 | API | API | Keys: read, write and one-project; every `/api/v1` read; the one-project key gets 404 for 17 reads and writes on another project's objects; read key refused on writes; bad and revoked keys 401; limits and bad status 400 | Pass | | |
| S-18 | API, INT | API | Webhook to a local sink (the fixture server): delivered and the `Plaudit-Signature` verifies; API subscriptions to private addresses refused | Pass | | |
| S-19 | MCP | API | `initialize`, `tools/list` (no write tools for a read key), 8 tools called; a one-project key refused another project's data; bad key 401 | Pass | | OAuth connectors with real assistants are Blocked (STATUS item 6) |
| S-20 | EXT-01 | API | CORS: Chrome and Firefox extension origins with a key get their origin back and the preflight; other origins and no key get none | Pass | | |
| S-21 | INT-08 | Owner | Stripe purchases: signed event recorded once (replay is a duplicate), wrong signature, old timestamp, garbage, 2 MB body and unknown connection refused; only the first name kept; the secret is never returned; the sales feed | Pass | | Real Stripe is Blocked (STATUS item 3) |
| S-22 | AI | Owner | Without an AI provider: themes, case-study draft, survey draft and social rewrite say AI isn't on (409); Ask and smart search fall back to keywords; translation says it isn't set up; Insights and NPS load | Pass | | Real providers are Blocked (STATUS item 4) |
| S-23 | Security | Visitor | Pending media, captions and `/t/` 404 to the public; media path traversal; SVG, disguised and HTML files refused as project, form, booster and wall images and studio uploads; frame headers on admin, `/t/` and the embed | Pass | | |
| S-24 | Accessibility | All | 18 pages with reduced motion and a dark colour scheme: every control has a name, images have alt, no duplicate ids, `lang` set, one h1; keyboard order on the form with visible focus | Fail | B-03 | No dark mode (the pages stay light, by design). The form builder and wall editor have a second h1 inside their live preview |
| S-25 | INT-01, TEAM | Team | Email notifications: a viewer limited to one project, with "each one" on, is told only about that project; the owner about both | Pass | | |
| S-26 | INBOX | Owner | Inbox on desktop and a Pixel 7: search, select the page, bulk approve, bulk tag, delete to the trash, restore, open the drawer | Pass | | The drawer shows the j/k/a/h keyboard hints on a phone too (cosmetic, not logged) |
| S-27 | Flags | Owner, Visitor, API | `PLAUDIT_FEATURES=none`: 14 sections and pages 404, the core pages stay; `api2` paths and `/mcp` 404; the Stripe webhook 404s with `commerce` off | Fail | B-04 | Which public pages follow their flag is inconsistent |
| S-28 | AI | Owner | AI switched on against a stand-in provider that answers 404, 500, HTML, empty choices, junk and 40 s late: every AI action answers a readable 502 (Ask falls back to keywords); nothing hangs or leaks a stack | Pass | | |
| S-29 | Sign-in | Owner | Session cookie: HttpOnly, SameSite=Lax, 7 days; after Sign out, a copy of the old cookie still works | Fail | B-05 | |
| S-30 | VID | Owner, Visitor | Trim (bad ranges refused), poster frame, a social clip rendered and downloaded, re-transcribe; approved: the trimmed MP4 and HLS are public, the original isn't; rejected: HLS 404 | Pass | | |
| S-31 | Data, Security | Owner | CSV export of a name and text starting with `=` and `+`: neutralised; audit log CSV | Pass | | |
| S-32 | FORM, AN | Owner, Visitor | Form builder: edit the main question, add an NPS question, save; the public form shows the new title as text; languages (Tamil, Arabic RTL, Hindi; unknown refused); the form's drop-off chart after the edit | Fail | B-06 | |
| S-33 | Empty states | Owner, Visitor | A project with nothing in it: every section, the trash tab, its wall, collection page and embed | Pass | | |
| S-34 | REQ, FORM-13, INT-07, IMP, VID-05..08, SHARE-01..03, social drafts | All | Rewards (wheel, unique codes, coupons against the stand-in Stripe), importers (App Store, Trustpilot saved page, CSV, Senja…), multiclips, highlight reels, image studio and social drafts in the browser | Pass | | Not driven by hand here: run through the existing e2e specs in the full Chromium suite (see the Log) |

## Bugs

| Bug | Severity | Area | What happens | Fix (commit) | Test | Status |
|---|---|---|---|---|---|---|
| B-01 | S2 | TEAM, image studio | An editor limited to some projects can rename or delete another project's saved image-studio templates, and delete its uploads, if they know the id (`PATCH/DELETE /api/admin/share-templates/<id>`, `DELETE /api/admin/share-assets/<id>`). Repro: owner makes a template in project B; an editor limited to A sends `PATCH /api/admin/share-templates/<B's id>` `{name}`: 200, renamed. Cause: the path's project lookup didn't know these two segments | c33cb41 | `tests/team-scoping.test.ts` "TEAM-01 an editor limited to one project can't rename or delete another project's saved templates or uploads (B-01)"; `tests/guard-rails.test.ts` "TEAM-01 every /api/admin/<object>/[id] route open to editors or viewers finds the object's project (B-01)" | **Closed** (gate, 2026-10-30) |
| B-02 | S3 | REQ, campaigns | A broken or truncated campaign link (`/r/<token>`) shows bare monospace text with no phone layout, unlike the other email links (`/u`, `/d`, `/w`), which show a "Link not found" page. Repro: open `/r/badtoken` | abd5102 | `tests/campaigns.test.ts` "REQ-04 a broken link answers with a readable page like the other email links, not bare text (B-02)" | **Closed** (gate, 2026-10-30) |
| B-03 | S3 | WALL-04, accessibility | A testimonial page (`/t/<id>`) with a quote and no headline has no h1: the hidden heading was only rendered when there was no text either. Repro: open any approved text testimonial's `/t/` page and list its headings | 1de8743 | `e2e/video-share.spec.ts` "WALL-04 SHARE-03 a testimonial's own page…" (checks the one h1) | **Closed** (gate, 2026-10-30) |
| B-04 | S3 | Feature flags | With a section's flag off, its admin pages 404, but its public pages don't agree: `/t/` and `/cs/` 404 (they follow `walls` and `insights`), while named walls (`/wall/<project>/<wall>`), step-by-step forms (`/f/…`) and booster pages (`/b/…`) keep serving. Repro: start with `PLAUDIT_FEATURES=none`, open a published booster's `/b/` link: 200 | — | — | Open — needs decision: whether turning a flag off should also stop links customers already have (D20 says flags only hide pages; WALL-04 deliberately follows `walls`). Pick one rule and apply it to all five |
| B-05 | S2 | Sign-in, security | Signing out only clears the browser's cookie; the session token stays valid for its 7 days, so a copied cookie (shared computer, leaked proxy log) keeps working after Sign out. Repro: sign in, copy the cookie, Sign out, call `/api/admin/projects` with the copy: 200. Removing a member does end their sessions | — | — | Open — needs decision: sessions are stateless HMAC tokens by design (SPEC). Revoking needs server state, e.g. a per-person "signed out at" time (an additive migration on `members`) checked in `verifySessionToken`, plus a "Sign out everywhere" button |
| B-06 | S3 | FORM-15 analytics | The form drop-off chart counts visitors by page position, so after adding, removing or moving a page the old counts move to other pages. Repro: send a few step-by-step forms, add an NPS question near the top and save: "NPS question" shows visitors nobody had, "Review and send" shows 0 while "Sent" is 8 | — | — | Open — needs decision: the beacon would need a stable page key (questions have one; other pages don't), and existing daily rows keyed by position can't be mapped back reliably |

Severity: **S1** data loss, security or a workflow that can't be finished; **S2** wrong result or broken screen with a workaround; **S3** cosmetic or copy.

## Log

- 2026-10-30: tracker started.
- 2026-10-30: sweep server up on 3310 (production build of `main` at 55c7f6b, own data folder, outbox mail, no AI provider), mock sign-in on 3399, fixture server on 3398. S-01 to S-07 run; B-01 found and fixed.
- 2026-10-30: S-08 to S-24 run; B-02 and B-03 found and fixed (B-03's new check failed against the unfixed sweep server first).
- 2026-10-30: restarted the sweep server with `PLAUDIT_FEATURES=none` (S-27), then with every flag on and the stand-in AI provider (S-28). S-25 to S-34; B-04 to B-06 logged as needing a decision.
- 2026-10-30: checks on `plaudit/bug-sweep` with the fixes:
  - `npm run typecheck`: clean.
  - `npm test`: 1,186 passed, 10 skipped (3 new tests for B-01 and B-02).
  - `node scripts/req-coverage.mjs --all`: 112 of 112 requirements covered.
  - `npm run db:check`: 23 migrations, no schema drift (no migration added).
  - Playwright, full Chromium suite (ports 3200–3202): 231 passed, 1 skipped (the home-page screenshots test, which only runs with `UPDATE_SCREENSHOTS`), 8.3 min. `e2e/video-share.spec.ts` (touched for B-03) also in WebKit: 7 passed.
  - The sweep server restarted on the fixed build: B-01 (an editor limited to one project now gets 403 on another project's template), B-02 (`/r/badtoken` is a styled 404 page on a phone) and B-03 (one h1 on `/t/`) checked live.
- 2026-10-30: summary: 34 scenarios: 27 Pass, 7 Fail (each with a bug), 0 Blocked. Things only a human can do (real Google, Apple, SSO, Stripe, AI, SMTP accounts, real devices, published add-ons, OAuth with real assistants) stay Blocked as in STATUS.md and were run only against the stand-ins. 6 bugs: B-01 to B-03 Fixed, B-04 to B-06 Open — need a decision.
- 2026-10-30, gate review: read the three fixes and their tests. B-01: the new unit test and the guard-rail test pass, and the B-01 test fails with `main`'s `src/lib/access.ts` (403 expected, the edit went through). B-02: the route now returns the same 404 status with an HTML page and a strict CSP; its test passes. B-03: one h1 in both branches of the headline check, covered by `e2e/video-share.spec.ts` (Chromium and WebKit runs above). B-01 to B-03 **Closed**. B-04 to B-06 stay open for Suresh's decision.
