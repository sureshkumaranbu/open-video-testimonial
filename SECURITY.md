# Security

## Reporting a vulnerability

Please report security problems privately. Use GitHub's **Report a vulnerability** button on the repository's Security tab, rather than a public issue. Include steps to reproduce, and say whether the issue is already public. You'll get an answer as soon as a maintainer can look at it, and a fix will be credited to you if you'd like.

## What Plaudit does to stay safe

**What it runs and installs**

- **No telemetry or tracking.** Plaudit makes outbound requests only to services you configure:
  - your SMTP server
  - your transcription API
  - your webhook URLs
  - media URLs in CSV files you import, with private-network addresses refused by default
- **Few runtime dependencies**, all widely used and pinned in `package-lock.json`:
  - Next.js, React, better-sqlite3, Drizzle ORM, Zod, nodemailer
  - nodemailer and the test-only smtp-server are pinned to exact versions that had been published for more than two weeks when they were added
  - CI runs `npm audit` on production dependencies
- **No install scripts in the Docker build** (`npm ci --ignore-scripts`). better-sqlite3 ships prebuilt binaries.
- The container runs as the unprivileged `node` user.

**Accounts, keys and tokens**

- The single owner signs in with a session that's an HMAC-signed, HttpOnly, SameSite=Lax cookie. Every change made with that cookie must also carry this site's `Origin` (or `Sec-Fetch-Site: same-origin`), as a guard against cross-site request forgery. API-key requests don't use cookies and aren't affected.
- **Rate limits** key on the client's real address:
  - The address comes from the connection itself, and `X-Forwarded-For` counts only with `TRUST_PROXY` set. Even then only the entry your proxy added counts, so clients can't make up new addresses to reset their limits.
  - Sign-in allows 10 wrong passwords per address per 15 minutes.
  - After a few wrong passwords from anywhere, every attempt is slowed down (up to 4 seconds), but nobody can lock the owner out.
  - Public submissions, uploads and withdrawals are limited per address too.
- **Secrets at rest**:
  - API keys and upload tokens are stored as SHA-256 hashes.
  - Withdrawal tokens are stored as hashes.
  - Request and unsubscribe links are HMAC-signed.
  - All of them are compared in constant time.
- **Webhooks** are signed with HMAC-SHA256 and a timestamp, and redirects are never followed.

**Files and media**

- **Uploads** are checked by their real file signature (magic bytes), not the name or the browser's claim. A video upload that doesn't start like a video is refused on its first chunk. Files are stored under random names that can't escape the uploads directory, and served with `nosniff`.
- **Media access**: a video, poster or photo is public only while its testimonial is approved and not withdrawn. Public responses must be revalidated on every use, so a rejection or withdrawal takes effect at once. Otherwise only the signed-in owner, or a request with a REST API key, gets it; anyone else gets a 404.
- **ffmpeg and transcription programs** are run with argument lists, never through a shell. ffmpeg may only read local files (`-protocol_whitelist file`). Both have time limits.
- **Archives being imported** are read without trusting entry names; files are looked up by their expected path. Sizes are checked on the decompressed output, which defends against zip bombs, and CRCs are verified.

**Pages and embeds**

- **Headers**:
  - Every response sends `X-Content-Type-Options: nosniff` and a `Referrer-Policy`.
  - Every page sends a Content Security Policy that only allows this server, and can't be framed by other sites. The exception is `/embed/*`, which exists to be framed.
  - The dashboard's policy allows scripts only with a fresh per-request nonce.
  - Private links send no `Referer` at all.
- The embed widget renders inside Shadow DOM and inserts user text only with `textContent`, never as HTML.
- Exported CSV cells that could run as spreadsheet formulas are neutralised.
- Public pages and feeds never include email addresses, consent records or unapproved testimonials.
- The public form never triggers email. Receipts go only to addresses the owner invited.
- Public uploads are read with a byte limit, even when there's no `Content-Length`, and each project may have at most 50 unfinished uploads at a time.
- **CSV media downloads** refuse private, loopback, link-local and similar addresses. That includes IPv4-mapped IPv6 and NAT64. The check runs inside the connection's own DNS lookup, so DNS rebinding can't get round it.

## Known limitations

- The rate limiter and background worker are in-process, so run a single instance.
- Behind a reverse proxy, set `TRUST_PROXY=true`, or every visitor shares the proxy's address and its limits. Leave it off when Plaudit is reached directly.
- Public pages are prerendered, so their CSP allows inline scripts (Next.js's bootstrap needs them). The dashboard's doesn't.
