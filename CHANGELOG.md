# Changelog

## Unreleased

- **Security:** nodemailer 10.2.1, which fixes three address-parsing advisories in earlier versions. Plaudit only sends to strictly checked addresses, so it wasn't exposed in practice.
- Fixes from an A-Z bug sweep:
  - Playing a fresh recording back shows its length and can seek.
  - A photo the server wouldn't accept (an SVG, say, or over the size limit) is refused as soon as it's picked, next to the photo field, instead of "Looks good" until submit.
  - Asking for someone's email sign-in links can't lock them out. Past the per-address limits the answer is the same and nothing is sent.
  - A project imported beside its original is named "… (imported)".

- **Sign in with Google, Apple or an email link, and invite your team.** The step-by-step guide is [`docs/AUTH.md`](docs/AUTH.md).
  - **Email links:** single-use, 15 minutes, and only in the browser that asked. Needs email.
  - **Google**, with an optional Workspace domain.
  - **Apple**: needs a paid developer membership and HTTPS.
  - **Settings → Team:** invite people by email, or remove them; their sessions end at once. You can also let people in with `ADMIN_EMAILS` or `ALLOWED_EMAIL_DOMAINS`. There's one owner (`ADMIN_EMAIL`); everyone else is an admin.
  - Only the methods you set up are shown. Settings → This server lists each one and what it still needs.
  - `PASSWORD_LOGIN=false` turns off the password once another method works.
  - The session cookie's name now includes a hash of `PUBLIC_URL`, so two local instances don't sign each other out. **Upgrading signs everyone out once.**
  - Database migration `0007` adds the team and sign-in tables.

- **Email setup is easier to get right.**
  - **Send test email** in Settings shows the mail server's exact error, plus what to do about it.
  - A step-by-step guide, [`docs/EMAIL.md`](docs/EMAIL.md), with settings for common providers.
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_SECURE` can be used instead of `SMTP_URL`.
  - A warning when `SMTP_FROM` isn't set.
  - Requests shows "Retrying: <error>" instead of "Sending…".
  - A refused login, sender or address fails at once instead of being retried.
  - A wrong host or port now times out in seconds, not minutes.

Fixes from a release QA pass:

- **Security**
  - Rate limits use the real client address; forwarding headers count only with the new `TRUST_PROXY` setting.
  - Wrong passwords back off instead of letting anyone lock the owner out.
  - Media of pending, rejected or withdrawn testimonials is no longer public.
  - CSP, `nosniff` and `Referrer-Policy` headers on every page.
  - Changes made with the dashboard's cookie need an `Origin`.
- **Uploads**: a file that isn't a video, or is over the size limit, is refused before any of it is uploaded, with "Choose another file".
- **CSV import** lists the ratings, dates, emails and URLs it had to leave out, by line, instead of changing them silently.
- **API**
  - Withdrawn testimonials have status `withdrawn`.
  - `limit` outside 1–100 is a 400.
  - "Invalid API key" vs "Missing API key".
  - Validation errors are plain English.
- The dashboard fits a 375px phone.
- Bad private links return 404.
- A favicon.
- The hero's badge swap no longer overlaps.

- **Home page: real sample video testimonials.**
  - The sample clips and faces are now licensed stock footage from Pexels, with every source listed in [`docs/CREDITS.md`](docs/CREDITS.md).
  - The hero demo's Recording step plays a muted, looping clip, but only while it's in view, and shows the poster instead with reduced motion or Save-Data.
  - A wall of video cards now sits near the top.
  - Every sample card shows a face.
  - Names and quotes stay fictional and are labelled as samples.

## 0.2.0

The top features from [`docs/research/feature-opportunities.md`](docs/research/feature-opportunities.md).

- **Mobile-first recorder.**
  - MP4 recording on Safari and iOS, a countdown, on-screen questions, a portrait layout and a camera switch.
  - A per-project time limit, and a "use camera app" fallback.
- **Resumable uploads.** Video uploads in pieces while it records and resumes after dropped connections.
- **Video conversion.** With ffmpeg, every video becomes MP4 (H.264/AAC) with a poster, and the original is kept. ffmpeg is in the Docker image.
- **Transcripts and captions** from a local program (such as whisper.cpp) or an OpenAI-compatible API. Both are editable, and captions are on by default in every player.
- **Consent ledger.** Versioned wording, scopes, an append-only history, an "edited after consent" flag and a private withdrawal link.
- **Request links.** Prefilled personal links, invitations and reminders through your own SMTP, one-click unsubscribe, and receipt emails.
- **REST API** (`/api/v1`, OpenAPI 3.1) with read and read-write keys, plus **signed webhooks** with retries and a delivery log.
- **Import and export.**
  - One-zip export of everything, which imports as a new project on any server.
  - CSV import with a column mapper and optional media download.
- A Settings page showing which optional features are on, plus API keys and webhooks.

Database migrations `0001` to `0005` are applied automatically on start-up. Existing videos are converted in the background once ffmpeg is available.

## 0.1.0

The first release: collection page, dashboard, wall of love, script and iframe embeds, and Docker.
