# Walls and SEO

_On by default (the `walls` section; `PLAUDIT_FEATURES` can turn it off). Without it the **Walls** and **SEO** tabs are hidden. Your project's wall at `/wall/<project>` stays exactly as it is until you mark a published wall as the main one._

## Walls

A wall is a page of your approved testimonials. Make as many as you like from the project's **Walls** tab, for example one for everyone and one per product. Each has its own address, `/wall/<project>/<wall>`.

A new wall is a **draft**: only you see it, in the editor's preview. Visitors get "not found" from its page, its link preview image and its "load more" until you publish it on the **Publish** tab. Moving it back to draft hides it again straight away.

**Main wall.** On the Publish tab, **Show at /wall/&lt;project&gt;** puts this wall at your project's wall address in place of the classic page. It only takes over while it's published, and only one wall can be main. Delete it or switch it off and the classic page comes back.

**Links.** Change a wall's link on the Publish tab. The old link keeps working and redirects (with a 308) to the new one. If you give a wall a link that another wall used to have, that old redirect stops and the editor says so.

## The editor

Settings are on the left, and the preview on the right shows your unsaved changes at desktop or phone width. **Save changes** updates the page; the editor warns you before you leave with unsaved changes.

| Section | What you set |
|---|---|
| Content | The hero (title, subtitle, alignment, colours, the total and average rating, a featured testimonial), the hero button (text, link, colours, and which form it opens when it has no link of its own), the header (logo, where it links, up to 4 links) and a cover image behind the hero |
| Look | One of five themes (Paper, Night, Sunrise, Meadow, Studio), the font, card colours, corner radius and shadow, 1 to 4 columns, "Load more" or infinite scroll and how many per page, and what each card shows (rating, video, images, photo, job title, headline, a link to the original review, a "Verified" mark, the date) |
| Testimonials | The lowest rating, the kind (text, video, with images), the order, **tabs** that filter by tag (one of them the default), and a **call to action between the cards** after the number of cards you choose |
| SEO | The page title and meta description, **Hide from search engines** (noindex), and what the reviews are about (for the review data) |
| Publish | Draft or published, main wall, the wall's link |

Phones get one column; the tabs are plain links, so they also work with JavaScript off. With infinite scroll the next page loads as visitors near the end, and the **Load more** button stays there as a fallback.

## What search engines get

Every published wall, and the classic page, is rendered on the server: the testimonials are in the HTML.

- **Title and description** from the SEO section (or the hero's title and subtitle).
- **Canonical link**: the wall's own address, or `/wall/<project>` for the main wall, without tabs or other query parts.
- **noindex** when you switch on Hide from search engines.
- **Review data** (JSON-LD, schema.org `Review` and `AggregateRating`): up to 10 reviews and, once at least one has stars, the average. Text is escaped, so nothing a customer wrote can break out of it.
- **Link preview image** (`/wall/<project>/<wall>/opengraph-image`, 1200×630): your title, rating and three short quotes in the wall's theme, or your cover image when it's a PNG or JPEG.

## Favicon, analytics and verification

The **SEO** tab also has a few head options for the wall. They're fixed fields that Plaudit turns into tags itself; you can't paste HTML or scripts, so nothing you or a teammate types can run on the page.

- **Favicon**: a PNG or ICO under 512 KB. Without one, the project's logo is used.
- **Analytics**: none (the default), **Plausible** (your site's domain, such as `example.com`) or **Google Analytics 4** (a measurement ID such as `G-ABC123DEF4`). Once chosen, that provider's script loads on this wall only, and the wall's Content Security Policy allows that provider's addresses and no others; your other walls, forms, widgets and the dashboard stay as they were. **The provider will see this wall's visitors**: their address, browser and the pages they view. Mention it in your privacy notice and, for Google Analytics (which sets cookies), ask for consent where the law needs it. Plaudit's own wall numbers are cookieless and need none of this ([analytics](analytics.md)).
- **Site verification**: the code from Google Search Console, Bing Webmaster Tools or Facebook's domain verification meta tag (only the `content` value: letters, digits, `-` and `_`).

## A testimonial's own page

Each approved testimonial also has a page of its own at `/t/<id>`, with review data and a link preview image of the quote. See [Sharing](share.md).

## Review snippets for your own pages

The **SEO** tab makes review data for pages on your own site, such as a product or pricing page. Pick which testimonials count (all, some tags, or one form), what's being reviewed (product, organisation, local business, software or course), its name and page. Each snippet has two codes:

- **Dynamic**: `<script src="https://your-plaudit.example/schema/s_….js" async></script>`. It adds the latest reviews to the page every time it loads (the script is cached for 5 minutes).
- **Static**: a `<script type="application/ld+json">` block with the reviews as they are now. Paste it again after you approve new ones.

The page also explains what to expect, and shows an example search result:

- Rich results usually need **at least 5 reviews**; the snippet warns until you have them.
- Put it on the page about the thing being reviewed, **not your home page**.
- Valid data makes stars possible, not certain: **the search engine decides**. Search engines rarely show stars for reviews a business publishes about itself, so a product, software or course page is a better fit than an organisation.

Deleting a snippet makes its script send nothing, so a forgotten tag never breaks a page. You can check the result with a rich results testing tool.
