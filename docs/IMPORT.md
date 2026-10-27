# Importing from review sites and other tools

Plaudit can bring in reviews from 30 review sites and places (22 of them with the `imports2` flag, on by default) and move testimonials over from 3 other testimonial tools, keep a source in sync, and read spreadsheets. Everything goes through one flow on **Import & export → Import from review sites and other tools** (the `importers` section, on by default):

1. **Pick the source.**
2. **Say which listing**: a link, a name, an app ID or your API key, depending on the source.
3. **Choose options**: a minimum rating, skip reviews with no text, tags to add, and whether they arrive **Pending** (the default) or **Approved**.
4. **Tick "I own or manage this listing".** The server refuses an import without it.
5. **Preview** the latest 50 that match your options. Items already in the project are marked "Already imported".
6. **Import selected**, or **Import all matching** (up to 1,000). The import runs in the background with a progress bar and ends with a summary: "N new, M already imported".

Imports never add the same review twice. Each imported testimonial keeps where it came from (`platform`), its id there (`source_review_id`), its link (`source_url`), its original date (`source_date`, with `date_precision`), and when it arrived (`imported_at`). Uniqueness is on (project, platform, source review id), so a re-run, a second upload of the same file or two imports at once only count duplicates. When a source gives only a month, the date shows as "Oct 2026", never a made-up day.

Bulk imports send no per-row webhooks. One `import.completed` event is sent when a run finishes, to webhooks that select it (it's opt-in; catch-all webhooks don't get it). Its `data.import` has `id`, `source`, `platform`, `imported`, `duplicates`, `skipped`, `failed`, `startedAt` and `finishedAt`. Videos and avatars are downloaded afterwards by the `import.media` job, the same one CSV imports use.

When an import from a review site's address or ID has finished, **Keep this in sync** offers to run it again on a schedule ([below](#keeping-a-source-in-sync)).

When a site won't let Plaudit read the page, you'll see **Upload the saved page instead**. Open the page in your browser with the reviews showing, choose **File → Save page as** (HTML only), and upload that file. It's read the same way and fetched from nowhere.

## Sources

| Source | Method | What you give | Limits and notes |
|---|---|---|---|
| Google | Official API (Places API (New)) | Business name and town, or a place ID | Needs your own `GOOGLE_PLACES_API_KEY`, sent in the `X-Goog-Api-Key` header, never in a URL. Google shares **at most 5 reviews per place**, so import often or add others by hand. Uses the reviewer's original text, not Google's translation. |
| Trustpilot | Public page data (JSON-LD) | Business page or domain | Reads `trustpilot.com/review/<domain>`, 20 reviews a page, up to 50 pages, with the page's embedded data as a second reading. Trustpilot limits automated visits; the saved-page upload is the dependable way in. |
| G2 | Public page data (JSON-LD or microdata) | Product reviews page or slug | Best effort: G2 is behind bot protection. When blocked, upload the saved page or use a CSV. |
| Capterra | Public page data (JSON-LD or microdata) | Product reviews page | Best effort, as G2. One page per run. |
| Product Hunt | Your API token (GraphQL API v2), or the public page | Launch or product page | With `PRODUCT_HUNT_TOKEN` and a `/posts/<slug>` link, reads the launch's **comments** (the public API exposes comments, not product reviews), 20 a page. Without a token, reads the reviews on `/products/<slug>/reviews`, which may be blocked; then upload the saved page. |
| App Store | Public feed | App Store link or app ID, and a country | Apple's customer-reviews RSS feed (JSON): 50 a page, at most 10 pages (500 reviews), one country at a time. |
| Google Play | Reads the public page, or the Play Console CSV | Store link or package name, or the reviews report | Google Play has no public review API. The store page shows only a few reviews and its markup changes; for all of them, download **Download reports → Reviews** in the Play Console and upload it (UTF-16 is fine). The report has no reviewer names, so they arrive as "Google Play user". |
| X | Official embed (oEmbed) | Up to 50 post links, one per line | `publish.twitter.com/oembed` for each link; public posts only. Deleted or protected posts are left out. |
| Testimonial.to | Reads the public Wall of Love, or the CSV export | Wall of Love link, or the export file | The wall has only what's on it; the CSV export also has the rest. Videos come across. |
| Senja | Your API key, or the CSV export | API key, or the export file (in Senja: **Proof → ⋮ → Export all to CSV**) | `GET https://api.senja.io/v1/testimonials` (Bearer key), 50 a page, up to 20 pages. Keeps each one's original review site as its platform (Senja's `integration`) and its id there (`platform_id`). Videos come across. The CSV puts every answer of a multi-question form into one `text` cell, separated by commas, so they arrive as one text. |
| Shapo | Your API key | API key (in Shapo: **Settings → General → API Key**) | `GET https://api.shapo.io/testimonials` (Bearer key), 50 a page. Shapo has no export button, so the API is the only full route; its free plan shares only the 15 newest. A CSV you made yourself can still be uploaded. Video links come across when the API has them. |

### Added in M13 (`imports2`)

| Source | Method | What you give | Limits and notes |
|---|---|---|---|
| YouTube | Official API (oEmbed, or the Data API with your key) | Up to 20 video links | Without a key, each video imports as a testimonial of its own: its title and channel and a link to it (the video stays on YouTube). With your own `YOUTUBE_API_KEY`, the comments on each video instead, newest first, 100 a page; videos with comments turned off are skipped. |
| Reddit | Public feed (the post's JSON) | A post link | The post (when it has words) and its top-level comments, not replies, removed comments or bots. Reddit limits automated reading and may block it; then upload the saved post page (its structured data is read). |
| WooCommerce | Official API (the Store API) | Your shop's address | `/wp-json/wc/store/v1/products/reviews`, which every WooCommerce shop has, no key: 100 a page, up to 1,000. Falls back to `?rest_route=` for shops without pretty links. A security plugin may block it. |
| Etsy | Official API with your key | Shop link, name or number | Needs your own `ETSY_API_KEY` (sent in the `x-api-key` header). Etsy's API shares no buyer names, so reviews arrive as "Etsy buyer". |
| WordPress.org | Public feed | Plugin page or slug | The plugin's official reviews feed (`/support/plugin/<slug>/reviews/feed/`), page by page, with the stars from "Rating: N stars". |
| Apple Podcasts | Public feed | Show link or ID, and a country | Apple's customer-reviews feed, as for the App Store. Apple doesn't promise it for shows; when it's empty, upload the saved show page. |
| Feefo | Official API | Reviews page or merchant identifier | Feefo's public reviews API (`api.feefo.com/api/20/reviews/all`), no key: the service review and each product review of an order, 100 a page. |
| Shopify store | Public page data | Up to 20 product pages | The schema.org reviews a review app (Judge.me, Loox, Okendo, Yotpo, Stamped, Reviews.io) adds to each product page. When an app only draws them in the browser, it says which app and asks for the saved page (or the app's own CSV export). |
| Clutch | Public page data | Company profile | As G2: best effort behind bot protection; then the saved page. |
| AppSumo | Public page data | Product page | The reviews page's schema.org data, when it has some; else the saved page. |
| Udemy | Public page data | Course page | Only the few reviews the course page carries; for more, press "Show all reviews", scroll, save the page and upload it. |

**Saved pages only.** These need a login, or their terms forbid automated collection and they block it, so Plaudit never visits them. Open the page in your browser with the reviews showing, save it (**File → Save page as**, HTML only) and upload it. The importer has no address field: just the upload, the options and the ownership box.

| Source | What to save |
|---|---|
| Yelp | Your business page (Yelp's API shares only three short excerpts) |
| Facebook | Your page's Reviews tab, scrolled to the ones you want; or a single post |
| LinkedIn | The post (its comments come too when the page has them) |
| Tripadvisor | Your listing with the reviews showing |
| Amazon | Your product's reviews page |
| Fiverr | Your gig or profile, after "Show more" |
| Airbnb | Your listing's reviews or your host profile |
| Zillow, Realtor.com | Your agent profile |
| Chrome Web Store | Your extension's Reviews tab, scrolled |
| Trustindex | A page of your own site with the Trustindex widget on it (each review keeps the site it came from, like Google, when the widget shows it) |

A saved page is read the same way for each: schema.org reviews (JSON-LD, then microdata), then schema.org posts and comments, then review-shaped objects in the page's embedded data, and for Amazon and Trustindex their own markup. **We wrote these readers against made-up pages shaped like the real ones**, not against the sites themselves, so a site that changes its pages may need a fix; the CSV import is the way round that.

API keys you type for Senja or Shapo are used for that import only: they're dropped from the run's record when it finishes or fails, and never shown back.

### Endpoints we couldn't confirm

These were written from the services' public documentation as we understood it, and are read defensively (unknown fields are ignored, odd values left out). If one stops working, the saved-page or file upload still does.

- **Senja's CSV export** was checked against a real export on 2026-10-27: the person's title is `customer_tagline`, the plain `title` is the headline, and dates look like `2026-10-25 09:48:01.359+00`.
- **Senja and Shapo API response shapes.** We accept a bare list or a list under `testimonials`, `data`, `items`, `results` or `reviews`, and look each field up under the names these tools use (`customer_name` or `name`, `text` or `message`, `video_url`, `profileImage`…). A bare `title` is the testimonial's headline for Senja and the person's job title for Shapo and Testimonial.to.
- **Shapo page numbers.** It isn't documented whether pages count from 0 or 1, so we start at 0 and skip a page that repeats the one before.
- **Senja dates.** Senja stores a review whose source gave only a month as the 22nd at midnight UTC. We can't tell that from a real 22nd, so a Senja date exactly then is kept as the month only.
- **Testimonial.to walls.** We read the testimonial-shaped objects in the page's embedded data (`__NEXT_DATA__`), then JSON-LD reviews.
- **Product Hunt.** The GraphQL `post(slug:)` → `comments` query; there are no product reviews in the public API.
- **Google Play.** The store-page reading looks for review blocks marked with `data-review-id` and a "Rated N stars" label. It will break when Google changes the page; the Play Console report won't.
- **Trustpilot, G2, Capterra.** Whatever schema.org reviews the page carries, so a page without them, or a bot wall, asks for the saved page.

## Keeping a source in sync

After an import from a review site's address or ID (not a file or a saved page) has finished, **Keep this in sync** asks how often to check: every 24 or 12 hours. From then on:

- The hourly task starts each source that's due. A run is an ordinary "Import all matching" with the same options (minimum rating, skip empty, tags, status on import, so "Approved" means auto-approve), through the same job and the same dedupe: a review never arrives twice. A run stops at the first page with nothing new on it, because sources list newest first.
- **Import & export → Automatically synced** lists each source with its last run and whether it worked, the next run, how many testimonials it has added, and **Pause** / **Resume**, **Run now** and **Stop syncing** (what it imported stays).
- A run that adds reviews sends `import.completed` (with `syncId`) and, for people who turned on import emails, a summary. A run that finds nothing new sends nothing.
- **After 3 failed runs in a row** the owner is told: an email to everyone with import emails on, and a notice on the dashboard and on the source. Plaudit keeps trying on schedule, and the next run that works clears the alert.
- A sync stores the source's address or ID and your options, never an API key (Google's and Product Hunt's come from the server's settings). A project moved with its export brings its synced sources **paused**.

## Spreadsheets and pasted tables

With `imports2` on, the CSV import on **Import & export** also takes:

- **An Excel file (.xlsx).** The first sheet is read by Plaudit's own small reader (no extra software): text, numbers, true/false, and dates by their number format, as `2026-10-27` (or with the time). Formulas give their last saved value. Up to 20 MB, 10,000 rows and 100 columns; a file that unpacks to far more than its size (a "zip bomb") is refused while it's read. Old `.xls` files aren't read: save them as `.xlsx` or CSV.
- **A pasted table.** Copy the cells with their header row in Excel, Google Sheets or Numbers, and paste them into **Or paste a table from a spreadsheet**. Tabs and commas both work.

Both go through the same column mapper, preview, warnings and import as a CSV, and each row is linked to a customer record by its email.

## Terms and ownership

Each source in the picker says how it reads and what its terms say. Plaudit asks you to confirm **"I own or manage this listing"** before anything is fetched, and the server enforces it. We can't prove ownership technically: it's your promise, so import only your own business, app or product. The people who wrote the reviews agreed to the review site's terms, not to Plaudit's consent wording, so every imported testimonial's consent record says "Imported from <source>. Consent was collected outside Plaudit; keep your own record of it."

Review sites' terms differ and change. Several (Trustpilot, G2 and Capterra among them) restrict automated access to their pages; prefer their official exports or the saved-page upload where that applies to you.

## Safety

Every outgoing request goes through `src/lib/net-guard.ts`:

- Only `http` and `https`; addresses with a user name or password are refused.
- Private, loopback, link-local, carrier-grade NAT, multicast and reserved addresses are refused, checked at connect time (so a DNS answer can't change between the check and the connect), for IP literals and names alike, on every redirect hop (at most 5).
- Pages and API answers are capped at 2–10 MB and 8–15 seconds depending on the source; media downloads at your upload limits.
- Imported text is stored as plain text: markup is stripped and entities decoded, and it's escaped wherever it's shown. Links keep only `http` and `https`.

Tests never reach the real sites. `IMPORTER_ORIGINS` (test only) points adapters at the fixture server, and `NET_GUARD_ALLOW` (test only) lets exactly that `host:port` through the guard. Fixtures in `tests/fixtures/importers/` are made up for the tests.

## Adding a source

One adapter file in `src/lib/importers/sources/<id>.ts` (see `types.ts` for `ImporterAdapter`), one line in `registry.ts` (or `sources/m13.ts` for a source behind `imports2`; a saved-page-only source is one call to `savedPageSource()` in `sources/_saved.ts`), an icon of our own in `public/importers/<id>.svg`, a synthetic fixture in `tests/fixtures/importers/<id>/` and a test in `tests/importers/<id>.test.ts` that drives `fetchPage` through an injected fetch. Adapters only fetch and normalise; filtering, dedupe, saving, progress and events are shared (`run.ts`).
