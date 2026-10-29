# Sharing testimonials

Two ways to take a testimonial beyond your site: its own page, and images from the **Image studio**. A third, a **case study** with its own page and PDF, is in [Insights, case studies and surveys](insights.md#case-studies).

## A testimonial's own page

Every approved testimonial has a page at `/t/<id>`: the quote or the video (with captions), the person, their rating, a button to your site (or your wall when the project has no website) and share links. Open it from the inbox drawer with **Its page**. The link preview (on X, LinkedIn, Slack…) is an image of the quote with your logo.

- Only testimonials that are **approved**, **not withdrawn**, and whose author didn't ask to keep them private have a page. Anything else, including an address that never existed, is the same "not found" page, and its image is a 404 too. The address uses the testimonial's random id, so pages can't be found by guessing.
- The share links are plain links to X, LinkedIn, Facebook and email: no scripts or buttons from those sites are loaded, so visitors aren't tracked by them unless they click.
- Search engines get review data (JSON-LD) for the testimonial, named after your main wall's SEO settings or your project.
- Views and share clicks are counted the cookieless way, like walls ([analytics](analytics.md)).
- The page follows the `walls` flag.

## The image studio

**Image studio** (a project tab, behind the `share` flag), or **Create image** in the inbox drawer, which opens it with that testimonial.

1. **Testimonials**: tick one to six. Templates for one testimonial use the first.
2. **Wording**: change the text, name or title for this image only. The testimonial itself never changes. Wrap words in `**double stars**` to highlight them; otherwise the testimonial's own highlights are used.
3. **Template**: fourteen of our own, for one (Spotlight, Margin note, Postcard, Headline, Portrait, Split, Speech bubble, Rating stamp, Plain, Ticket), three (Three columns, Stack) or six (Grid of six, Mosaic).
4. **Size**: square 1:1, portrait 4:5, story 9:16, landscape 16:9, a LinkedIn post, an X post, a 600×200 email banner, or any custom size up to 2048 × 2048 pixels.
5. **Look**: light or dark, accent, highlight and text colours, which details show. **Use the brand kit** takes your project's colours, font and logo.
6. **Background**: a colour, a gradient, one of five patterns, your own image (darkened as much as you like so the words stay readable) or none (a see-through PNG).
7. **Logo**: none, the project's logo, or an upload, in any corner or centred, at any size.

The preview is drawn by your server, exactly as the download will be, so it looks the same in every browser.

- **Download** a PNG or a JPEG (a JPEG can't be see-through, so it gets the theme's background). JPEG uses ffmpeg on the server; without it your browser converts the server's PNG.
- **Copy image** puts it on the clipboard, ready to paste (in browsers that allow copying images).
- **Download sizes as ZIP** makes the same image in each size you tick; **One image per testimonial** makes one each.
- **Save as my template** keeps the look (never the testimonials or your wording) to use again.
- **Share to X / Share to LinkedIn** downloads the image and opens that site's own post page with a link to the testimonial's page (or your wall when it has none). Attach the image there. Plaudit never posts for you and needs no keys; LinkedIn takes only the link, so paste your words yourself.

Uploads in the studio (backgrounds and logos) must be PNG or JPEG. They're private: only you can see them, and the server draws them into the image.

### Fonts and characters

Images use the TTF fonts in `public/fonts/og/`; Geist ships with Plaudit. Add `GeistMono-Regular.ttf`, `SchibstedGrotesk-Regular.ttf` or `Newsreader-Regular.ttf` there (all under the SIL Open Font License) and they appear in the studio's font list. Emoji are left out of images. Characters that the fonts don't have (Tamil, Arabic, Hindi and so on) are fetched by the image renderer, `next/og`, from Google Fonts on the server, so add a TTF that covers your language if your server shouldn't make that request.
