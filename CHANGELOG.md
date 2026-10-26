# Changelog

## Unreleased

- **Forms** (behind the `forms` preview flag). See [`docs/help/forms.md`](docs/help/forms.md).
  - Several forms per project, each at `/f/<project>/<form>`, made blank or from one of 8 templates. A step-by-step page shows one step per screen with a progress bar; Back keeps every answer, and a recording keeps uploading while people move between steps.
  - Up to 10 questions, each answered by video, text or either, with its own tips, video length and up to 3 images. Questions can be **optional**. Private questions go to private feedback, never published.
  - Custom fields (text, dropdown with an optional tag per choice, checkbox, NPS, web address, number), hidden fields from the link (`?utm_source=`), prefill (`?name=&email=…`) that can be locked, and "keep it private" consent.
  - Design (logo, colours, self-hosted fonts, width, buttons, radius, light or dark) and 11 languages, with right-to-left Arabic. Translations other than English need native review.
  - Per-form rules: auto-approve (every testimonial, a minimum rating, text only, or public consent), auto-tags, pause with a closed message, a per-IP daily limit, the receipt template, and form webhooks. They apply to the classic page too.
  - The builder previews every change with the real form at desktop, tablet and phone width, and asks before leaving only when something is unsaved. The share panel has the link, a QR code (PNG or SVG) and inline, popup and iframe embeds (`/form.js`, [`docs/EMBED.md`](docs/EMBED.md)).
  - The thank-you page can offer "copy my words" and share links (only with social consent), and a different message for 3 stars or fewer.
  - The inbox card shows a form submission's other answers (videos with captions), private feedback, custom and hidden fields. Answer videos are converted and transcribed like the main one, stay private, and auto-approve waits for all of them.
  - Request links can open a chosen form. Webhooks `form.submitted` and `feedback.created` (opt-in) are now sent.
  - The classic page at `/c/<project>` is unchanged until you **Switch to step-by-step**; then it forwards visitors, `?r=` and all, to the new page. Switching Video → Write → Video on the classic page no longer loses the recording.
- **Inbox v2** (behind the `inbox2` preview flag). See [`docs/help/inbox.md`](docs/help/inbox.md).
  - Seven tabs with live counts: All, Pending, Approved, Hidden, Rejected, Feedback (private answers) and Trash. On phones they make two rows of four.
  - Search over names, emails, companies, text, transcripts, every answer and tags, quick with tens of thousands of testimonials. Filters for rating, tags (any or all), source, how it arrived, type, form, language, consent, word count, date and attachments; sort by date added, date posted, rating, name or word count. The whole view is in the address bar, so a link shares it; your sort, view and page size are remembered.
  - Card and table views, pages of 25, 50 or 100, and bulk approve, hide, reject, tag, untag, export and trash for up to 500 at a time. Rows that can't take an action are skipped with the reason, and each change gets its own history entry and webhook.
  - A detail drawer with every answer, media and captions, fields, source, consent and history; keys j, k, a and h. Edit every answer, not just the main one, and highlight phrases. Edits are marked "edited after consent" and logged.
  - **Delete** now moves a testimonial to the trash, from which it can be restored with its status and media for 30 days; **Delete forever** is in the trash.
  - Export the current view, or a selection, as CSV or JSON with a column per custom and hidden field.
  - **Add testimonial**: add one you received elsewhere by hand, as text, a video or a screenshot, approved by default.
- **Keep media in an S3-compatible bucket** (AWS S3, Cloudflare R2, Backblaze B2, MinIO and others) with `STORAGE_DRIVER=s3` and the `S3_*` settings. Local disk stays the default. See [Media storage](README.md#media-storage-s3).
  - The bucket stays private: uploads are still checked on your server, and every file is streamed back through Plaudit under the same privacy rules.
  - **Settings → Media storage** shows where media is kept and whether the bucket works. The owner can **Copy local media to S3**, which is safe to run again; files not copied yet are served from local disk meanwhile.
  - Exports read from the bucket, and imports write to it.
- **Hidden and trash, in the API and webhooks.** Both are new statuses, and the dashboard's buttons for them arrive with the new inbox.
  - `hidden` keeps a testimonial for your own use and off your site. The API can set it.
  - `trashed` testimonials are off your site and can be restored with their old status, until they're deleted for good after `TRASH_RETENTION_DAYS` (30). API lists leave them out unless you ask for `status=trashed`. `DELETE` still deletes at once.
  - Approving a testimonial whose author asked to keep it private is refused (`409`).
  - New webhook events `testimonial.hidden`, `testimonial.trashed` and `testimonial.restored`. Endpoints with no events ticked get them too, so every takedown reaches them. New opt-in events: `testimonial.updated` (content edits), `form.submitted` and `feedback.created`, and `import.completed`, which is sent once importers are released.
- **More in each testimonial**, in the API, webhooks and exports: the form it came through, a headline, answers to further questions, images, the author's phone, website, social profiles and company logo, where a review was first posted and when (to the day, month or year), language, custom and hidden fields, featured and pin order, private consent and when it was trashed. `POST` and `PATCH` accept the editable ones. See [`docs/API.md`](docs/API.md#a-testimonial).
- **Exports carry everything new**: forms, customers, private feedback, widgets, walls, SEO snippets and old links, plus answers, images, highlights and edit history. The format is still version 1:
  - Older Plaudit versions can still import new exports. Hidden and trashed testimonials arrive there as rejected, and `statusV2` in `plaudit.json` keeps the real status.
  - Older exports import here as before, and get a default form made from the project's settings.
  - `testimonials.csv` keeps its columns and adds `form`, `headline`, `platform`, `source_url`, `source_date`, `language`, and a `custom:<key>` and `hidden:<key>` column for each field.
  - An imported project never takes over another project's old link. It gets the next free one instead (`acme-2`).
- **Features in preview**, hidden until they're finished. List them in `PLAUDIT_FEATURES` (or `all`) to try them. See [Features in preview](README.md#features-in-preview).
  - `forms` shows **Project settings**. Change a project's link and the old one keeps working: `/c`, `/wall` and `/embed` answer with a permanent redirect that keeps the query, so emailed request links still prefill, and widgets embedded with the old name keep loading. Delete a project, with everything in it, by typing its name (owner only). Set a brand kit (logo, colours and fonts) and rename, merge or delete tags across every testimonial.
  - The other flags show placeholder pages for now.
- **Upgrading.** Database migrations `0009` and `0010` only add tables, columns, indexes and triggers, and fill them in; no existing data is changed or removed. Take a backup first, as always.
  - `0009` adds the tables and columns for everything above. It gives every project a default form in today's one-page layout, made from its current settings, and links its form testimonials and requests to it. The collection page, wall, widget and iframe look and work exactly as before.
  - `0010` builds a search index over every testimonial, for the new inbox's search. On a large database the first start after upgrading takes a little longer.

- **Optional auto-approve for each project**, off by default. New testimonials from the collection page or a request link go live without a click when they have enough stars (4+ or 5) and no links in their text. Videos are included only if you turn that on, once they've been processed. Everything else waits in Pending. See [Auto-approve](README.md#auto-approve).
  - Turning it on doesn't approve what is already pending.
  - Auto-approved testimonials show an **Auto-approved** label and "Approved automatically (4+ stars)". Rejecting one takes it off your site as usual.
  - The API and webhooks say who approved a testimonial: `approvedBy` is `owner`, `api` or `auto`. Projects include their `autoApprove` settings.
  - Project exports include the settings. Older exports import with it off.
  - With it on, the receipt email no longer promises a review before the testimonial appears.
  - Jobs queued in the same millisecond now always run in the order they were queued.
  - Database migration `0008` adds the settings (off / 4 / off) and the approval record.

- **Security:** nodemailer 10.2.1, which fixes three address-parsing advisories in earlier versions. Plaudit only sends to strictly checked addresses, so it wasn't exposed in practice.
- **The camera preview shows you again.** It could stay black while recording, depending on how fast the page rendered; the recording itself was fine.
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
