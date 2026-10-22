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

- The single owner signs in with a session that's an HMAC-signed, HttpOnly, SameSite=Lax cookie. Write requests also check the Origin header, as a guard against cross-site request forgery.
- Sign-ins and public submissions are rate-limited per IP.
- **Secrets at rest**:
  - API keys and upload tokens are stored as SHA-256 hashes.
  - Withdrawal tokens are stored as hashes.
  - Request and unsubscribe links are HMAC-signed.
  - All of them are compared in constant time.
- **Webhooks** are signed with HMAC-SHA256 and a timestamp, and redirects are never followed.

**Files and media**

- **Uploads** are checked by their real file signature (magic bytes), not the name or the browser's claim. They're stored under random names that can't escape the uploads directory, and served with `nosniff`.
- **ffmpeg and transcription programs** are run with argument lists, never through a shell. ffmpeg may only read local files (`-protocol_whitelist file`). Both have time limits.
- **Archives being imported** are read without trusting entry names; files are looked up by their expected path. Sizes are checked on the decompressed output, which defends against zip bombs, and CRCs are verified.

**Pages and embeds**

- The embed widget renders inside Shadow DOM and inserts user text only with `textContent`, never as HTML.
- Exported CSV cells that could run as spreadsheet formulas are neutralised.
- Public pages and feeds never include email addresses, consent records or unapproved testimonials.

## Known limitations

- Media files are served by unguessable URLs but aren't access-controlled. Someone who has the URL of a pending video can watch it.
- The rate limiter and background worker are in-process, so run a single instance.
- The rate limiter keys on `X-Forwarded-For`. Run Plaudit behind a reverse proxy that sets that header, rather than exposing it directly.
