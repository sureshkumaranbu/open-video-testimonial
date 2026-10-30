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
| | | | | | | |

## Bugs

| Bug | Severity | Area | What happens | Fix (commit) | Test | Status |
|---|---|---|---|---|---|---|
| | | | | | | |

Severity: **S1** data loss, security or a workflow that can't be finished; **S2** wrong result or broken screen with a workaround; **S3** cosmetic or copy.

## Log

- 2026-10-30: tracker started.
