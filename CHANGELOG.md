# Changelog

## Unreleased

- **The setup guide's brand scan runs in the background** (ONB-02): the project is made at once, a progress bar follows the scan (30 seconds at most, `robots.txt` respected, 5 MB and 10 seconds per request, no private addresses), and the logo, colour and site name land on the project even if you move on first; the new form, wall and widgets take the colour. A site that can't be read keeps the default look. Optionally, `BRAND_AI_MODEL` (with `BRAND_AI_API_URL` and `BRAND_AI_API_KEY`) adds a step with your own OpenAI-compatible provider that can suggest the name, colour and testimonials; only what's really on the page is kept, and any provider problem is skipped silently. See [`docs/help/getting-started.md`](docs/help/getting-started.md#what-we-look-for-on-your-site).

- The recorder's end-to-end tests wait for what the page and server do rather than for fixed times, and the playback check no longer depends on whether the browser plays H.264.

- **Direct uploads to S3** (opt-in, `S3_DIRECT_UPLOADS=true` with `STORAGE_DRIVER=s3`): videos go from the browser straight to your bucket in 8 MB parts, through URLs Plaudit presigns for one object, one part's exact size and type, and ten minutes. Plaudit then checks the real size and sniffs the first bytes, deletes anything that isn't a video, and stores the rest as before. Needs the bucket's CORS to allow `PUT` from `PUBLIC_URL`; if it doesn't, uploads carry on through the server. Only then do upload pages' policies allow the bucket's address. See [README](README.md#direct-uploads-to-the-bucket).

- **Project access reaches files and jobs**: a member or API key limited to some projects now gets unpublished videos and photos (`/api/media/…`) only from those projects, and an import's progress only for theirs (progress that belongs to no project is for admins). Published files are unchanged.

- Migration 0018 adds three columns to upload sessions and an index on customer photos; nothing existing changes.

- **Roles and project access** (feature flag `team2`): owner, admin, editor and viewer, and the projects an editor or viewer may open, set in **Settings → Team**. The server checks the role and project on every dashboard request; lists, analytics and emails show only the projects someone may open. API keys can be made for one project. Existing teams are unchanged: everyone stays an admin with every project until the owner says otherwise. See [`docs/help/team.md`](docs/help/team.md).

- **Audit log** (`team2`): who approved, edited, deleted, trashed or exported testimonials, and every change to the team, keys, webhooks, campaigns, triggers, projects and connected assistants, filterable and as CSV. `AUDIT_RETENTION_DAYS` (365).

- **Stripe and Shopify triggers** for campaigns: paste the shop's signing secret, and a paid checkout or invoice, or a fulfilled order, invites the buyer after the days you choose. Signatures are checked over the raw body and each delivery counts once. See [`docs/help/campaigns.md`](docs/help/campaigns.md#stripe-and-shopify).

- **Sign-in for MCP connectors** (`mcp`): OAuth 2.1 with discovery, client registration, a consent page and PKCE, so Claude.ai's and ChatGPT's connectors can connect with just the address. Admins can disconnect them in **Settings → API keys**.

- **Webhook subscriptions through the API** (`POST`/`DELETE /api/v1/webhooks`), public addresses only; the Zapier app's triggers are now instant.

- Migration 0017 adds project lists for members and keys, the audit log, campaign triggers, the OAuth tables and `webhooks.api_key_id`; nothing existing changes.

- **More of the REST API** (feature flag `api2`): forms, widgets, walls, campaigns (start, pause and add recipients), tags, customers, private feedback, and analytics for a project or one widget, form, wall, snippet or testimonial page over `?from=&to=`. Each path makes the dashboard's own checks and answers with the dashboard's shape, without secrets such as a campaign's incoming webhook. `openapi.json` lists them. See [`docs/API.md`](docs/API.md#forms-widgets-walls-campaigns-and-more).

- **Single sign-on** with any OpenID Connect provider (Okta, Microsoft Entra ID, Authentik, Keycloak…), set up with `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` (and optionally `OIDC_LABEL`, `OIDC_SCOPES`, `OIDC_EMAIL_DOMAINS`, `OIDC_TRUST_EMAIL`). Who may sign in is decided as before. See [`docs/AUTH.md`](docs/AUTH.md#single-sign-on-oidc).

- **An MCP server** at `/mcp` (feature flag `mcp`) for Claude and other AI assistants, with an API key: list, search and read testimonials, get embed codes, a summary Plaudit counts itself, and invites for read-and-write keys. Assistants never get anyone's email or phone. See [`docs/help/mcp.md`](docs/help/mcp.md).

- **Integrations** (not in their marketplaces yet): a WordPress plugin with a block, `[plaudit]` shortcodes, SEO mode and a site-wide toast; a Zapier app; n8n and Make templates; and `@plaudit/react` with `PlauditWidget` and `PlauditForm`. See [`docs/help/wordpress.md`](docs/help/wordpress.md) and [`docs/help/integrations.md`](docs/help/integrations.md).

- **Auto-sync** (feature flag `imports2`): **Keep this in sync** after an import from a review site's address or ID re-runs it every 12 or 24 hours with the same options, deduped as always. **Automatically synced** lists each source with its last and next run and what it added, with pause, run now and stop. After 3 failed runs in a row you get an email (with import emails on) and a dashboard notice, and it keeps trying. See [`docs/IMPORT.md`](docs/IMPORT.md#keeping-a-source-in-sync).

- **22 more sources** (`imports2`): YouTube (each video as a testimonial, or its comments with your `YOUTUBE_API_KEY`), Reddit, WooCommerce's Store API, Etsy (your `ETSY_API_KEY`), WordPress.org, Apple Podcasts, Feefo, Shopify review apps, Clutch, AppSumo and Udemy; and from a page you save in your browser only: Yelp, Facebook, LinkedIn, Tripadvisor, Amazon, Fiverr, Airbnb, Zillow, Realtor.com, the Chrome Web Store and Trustindex.

- **Spreadsheets** (`imports2`): Excel (.xlsx) files and tables pasted from a spreadsheet go through the CSV column mapper, preview and warnings. Read by Plaudit's own small reader, with limits that stop oversized or "zip bomb" files.

- **Customer records** (feature flag `customers`): a Customers tab and a page per person with their testimonials, private feedback, invitations, campaign emails and rewards; edit, **Invite to a form**, **Ask for a video** and **Add testimonial**. Linked automatically as testimonials arrive, and older ones by an hourly job. See [`docs/help/customers.md`](docs/help/customers.md).

- **Possible duplicates and Merge into…** (`customers`): the same customer or email, or the same name with similar words, flagged and filterable in the inbox. A merge keeps both answers (the other one becomes an extra answer), combines tags and images, copies the consent record, and trashes the merged one, which can be restored. Nothing becomes public that wasn't.

- **Translations** (feature flag `translations`): per language in the drawer, by hand or with your own provider (`TRANSLATE_PROVIDER`: DeepL, LibreTranslate or OpenAI-compatible; server-side only, nothing without it); "translate new testimonials into" on forms; bulk Translate. Widgets can show the visitor's language (`widget.js` is 7,167 bytes gzipped), and testimonial pages take `?lang=`.

- **Smart search** (feature flag `aisearch`): search by meaning with your own embeddings endpoint (`EMBEDDINGS_MODEL`). Falls back to keyword search, and says so, without a provider or when it fails. With it on, testimonial text is sent to your provider. See [`docs/help/inbox.md`](docs/help/inbox.md#smart-search).

- The project export now carries campaigns and their recipients, review boosters and their clicks, reward codes, synced sources (no keys; they arrive paused, as do active campaigns), translations and merges. Older archives import as before.

- Migration 0016 adds the synced sources, translations and search tables, a merged-into column and owner-only images, and indexes on five older foreign keys (`testimonial_tags.tag_id` among them); nothing existing changes.

- **Video tools** in the inbox drawer ([`docs/help/video.md`](docs/help/video.md)): trim with a waveform and a preview (the original is kept, so a trim can be changed or undone; captions follow the cut), pick the poster from a frame or upload one, replace the file (it's converted and transcribed again), and download the original or the MP4. Each change is in the history and sends `testimonial.updated`.

- **A page for each testimonial** at `/t/<id>`: the quote or video, the person, a button to your site, plain share links, review data and a link preview image of the quote. Approved and public testimonials only. See [`docs/help/share.md`](docs/help/share.md).

- **Image studio** (feature flag `share`): images of 1, 3 or 6 testimonials in 14 templates, every social size or your own, wording for the image only, highlight colour, backgrounds, your logo, PNG, JPEG, ZIP and copy, saved templates, the brand kit, and “Share to X / LinkedIn”. Drawn on your server.

- **Custom CSS for saved widgets**, inside the widget only and cleaned so it never loads anything from another site ([`docs/EMBED.md`](docs/EMBED.md#custom-css)). `widget.js` is 7,157 bytes gzipped.

- **Wall head options**: a favicon, Plausible or Google Analytics 4 for one wall (its CSP allows exactly that provider), and site-verification codes. No raw HTML or scripts.

- Migration 0015 adds trim and poster columns, widget CSS, a wall favicon, and the image studio's uploads and templates; nothing existing changes.

- **Analytics** (feature flag `analytics`; `ANALYTICS=off` turns collection off too). See [`docs/help/analytics.md`](docs/help/analytics.md).
  - A dashboard at `/admin/analytics`: any period, compared with the one before, for one project or all. New testimonials by source, the review backlog, average rating, widget views, visitors and clicks, form views and completions, wall views and CTA clicks, review booster clicks, snippet renders and the campaign invite funnel; views by day; sortable tables of widgets, forms and walls.
  - Each widget shows where it's live ("Live on example.com/pricing"), its views, visitors, clicks by kind and top pages. A widget unseen for 7 days raises an alert in the app, an optional email, and the opt-in `widget.removed` webhook (`widget.installed` when it's seen).
  - Forms: views, visitors, starts, completions, completion rate, average rating and where people stop. The classic page counts views and completions on the server, with its markup unchanged. Walls: views, visitors, CTA and link clicks. Snippets: renders.
  - Cookieless: no cookies, no IP addresses or user agents stored, no third-party scripts; a visitor is a hash with a daily salt that's deleted after two days. Paths are kept without their query or fragment. Raw events are deleted after 30 days; daily totals stay.
  - `widget.js` stays within its budget (7,147 bytes gzipped); `data-project` embeds are unchanged and send nothing.

- Migration 0014 adds the analytics tables and three widget columns; nothing existing changes.

- **Review booster** (feature flag `booster`). See [`docs/help/booster.md`](docs/help/booster.md).
  - Pages of “Leave us a review” buttons at `/b/<project>/<page>`: up to 10 links for Google, Trustpilot, Yelp, Facebook, G2, Capterra, Tripadvisor, the App Store, Google Play, any link or one of your forms, in the order you drag them. Title, message, logo, colours, button style, a phone and desktop preview, and draft or public. Old addresses keep working.
  - Every visitor sees every link: there's no rating step, and the page never mentions a reward.
  - A Google review link from a Place ID or a Maps link, and business search when `GOOGLE_PLACES_API_KEY` is set (from the server only).
  - QR codes for booster pages and forms: any colour, your logo in the centre, print sizes at 300 dpi, PNG and SVG.
  - Clicks per link and day, with no addresses, devices or cookies kept. The page is plain HTML under 50 KB that loads nothing from other sites.

- **Rewards on forms.** A coupon code, a link, a unique code each from your own list (with claim tracking), or a wheel spun on the server, on the thank-you page and in the receipt email. Optional “only for video”. A reward never depends on the rating or the words. See [`docs/help/forms.md`](docs/help/forms.md#rewards).

- **Low ratings, privately** (off by default). A rating at or below your threshold shows a private feedback page instead of the questions and is kept as feedback, never published. It gets the same reward as everyone. Not for gating reviews on Google or Trustpilot.

- **Campaign reward codes.** A campaign can give each recipient their own code, in the email with `{{reward_code}}` and on their thank-you page.

- Migration 0013 adds the booster, click and reward-code tables; nothing existing changes.

- **Phase 1 is on by default.** Forms, the new inbox, the widget studio, walls and SEO, importers, notifications and the setup guide no longer need `PLAUDIT_FEATURES`; set it to a shorter list, or `none`, to hide sections. Nothing about your data, the API or public pages changes.

- **Notifications.** See [`docs/help/notifications.md`](docs/help/notifications.md).
  - Email for each person on the team, all off until turned on: each new testimonial or a daily digest, a Monday reminder of what's waiting, an import summary and a monthly report. Only people who have signed in, and can still sign in, get mail. Digests go out once at `DIGEST_HOUR_UTC`.
  - Slack, Discord, Microsoft Teams and Telegram channels with the stars, the quote and a **Review and approve** link that opens the testimonial in the inbox. A Test button, pause, per-project channels, and a per-form choice in the form builder. Only each service's own https addresses are posted to.
  - Testimonials added by hand or imported never notify anyone.
  - **Settings → Webhooks → Edit** changes a webhook's URL, events, project and form in place.

- **Setup guide.** See [`docs/help/getting-started.md`](docs/help/getting-started.md).
  - `/admin/welcome` asks for a project name, your website and what you sell, then reads your home page for your logo, colour and existing testimonials (schema.org reviews and quote blocks with a name; no AI), and imports the ones you choose as approved. It respects `robots.txt`, a 5 MB cap and a 10-second limit, and never reaches private addresses.
  - It makes a step-by-step form with questions for your business, a published main Wall of Love, and a grid and a carousel widget, in your colours.
  - A **Get started** checklist on the project (import or collect, customise a widget, add it to your site, share your link), with skip and hide. The dashboard shows a card for the guide and never redirects to it.

- **Empty states** on the inbox, widgets, walls, requests, the forms search and review snippets, each with one next step. Every new page fits a 360 px phone without scrolling sideways (the walls list now stacks on phones).

- **Importers**. See [`docs/IMPORT.md`](docs/IMPORT.md).
  - One flow for every source on Import & export: pick a source, say which listing, choose a minimum rating, skipping reviews with no text, tags and Pending or Approved, preview the latest 50, then import some or "all matching" (up to 1,000) in the background with progress and a summary.
  - Review sites: Google (Places API with your own key, 5 reviews at most), Trustpilot, G2, Capterra, Product Hunt (your own token, or the public page), App Store, Google Play (or the Play Console reviews CSV) and X (post links).
  - Moving from Testimonial.to (Wall of Love or CSV), Senja and Shapo (your API key or their CSV), videos included.
  - Never the same review twice: a re-run says "0 new, 20 already imported". Month-only dates show as "Oct 2026".
  - When a site blocks Plaudit, **Upload the saved page instead** reads a page saved from your browser.
  - You confirm "I own or manage this listing" before anything is fetched; the server checks it.
  - One opt-in `import.completed` webhook per run, and no per-row webhooks. The inbox shows each imported testimonial's source.
  - Outgoing requests refuse private network addresses on every redirect, with size and time limits.
  - The CSV importer also maps a platform column (Senja's `integration`, Shapo's `source`) and the original id, so the same file imported twice adds nothing new, and recognises Shapo exports.

- **Walls and SEO**. See [`docs/help/walls.md`](docs/help/walls.md).
  - Several walls per project at `/wall/<project>/<wall>`, each a draft until published. Drafts are "not found" for visitors, including their link preview image and "load more".
  - An editor with a live desktop and phone preview: five themes of our own, a hero with a featured testimonial and the average rating, a hero button, header logo and links, a cover image, fonts, card colours, columns, "load more" or infinite scroll, the card toggles, tag tabs with a default tab, and a call to action after a chosen number of cards.
  - One wall can be the project's **main wall**: `/wall/<project>` then shows it while it's published. Until then the classic page is unchanged. Renamed walls keep their old links (308).
  - Server-rendered pages with a title, meta description, canonical link, optional noindex, a generated 1200×630 link preview image, and escaped JSON-LD (`Review` and `AggregateRating`, up to 10 reviews). The classic wall page gets the JSON-LD and meta too.
  - **Review snippets** on the new SEO tab: schema.org data for your own pages, as a static JSON-LD block or a dynamic `/schema/s_….js` script, with guidance (5 reviews or more, not on the home page, the search engine decides) and an example result.

- **Widget studio**. See [`docs/help/widgets.md`](docs/help/widgets.md).
  - Saved widgets, each with its own id (`data-widget="w_…"`), in 8 layouts: masonry grid, list, carousel, multi-card slider, marquee, single featured, rating badge and floating toast.
  - Automatic or hand-picked testimonials with your own order and pins; filters for tags, rating, source, kind, keywords, language and form, applied on the server before the limit; newest, oldest, highest rated, inbox pins or shuffled.
  - Design (theme, font, colours, radius, spacing, width, shadow, and what to show, including dates, "Read more", highlights, a verified mark and first names only), per-layout options, editable labels, a rating summary and a "Leave a testimonial" button that opens a form as a page or a pop-up.
  - The studio previews every change with the real embed code at desktop, tablet and phone width. The Share tab has the script, an auto-sizing iframe, a hosted link at `/embed/w_…`, a React component, an email for your developer and guides for 9 site builders ([`docs/embeds/`](docs/embeds/README.md)).
  - An **SEO include** at `/api/widget/w_…/html` puts the review text in your page with JavaScript off, with optional JSON-LD.
  - Carousels and sliders pause on hover and keyboard focus, move with the arrow keys and have a pause button; reduced motion stops autoplay and the marquee; videos keep their captions.
  - `widget.js` stays small: the grid and list core is under 7 KB gzipped, and other layouts load on first use. `data-project` embeds draw exactly what they drew before.

- **Forms**. See [`docs/help/forms.md`](docs/help/forms.md).
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
- **Inbox v2**. See [`docs/help/inbox.md`](docs/help/inbox.md).
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
