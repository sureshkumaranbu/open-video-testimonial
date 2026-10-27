# Review booster

A review booster is a small page of “Leave us a review” buttons, one for each review site you're on. Share its link after a sale, or print its QR code for the counter, a receipt or the packaging. Find it under **Review booster** in a project (feature flag `booster`).

Each project can have several pages, at `/b/<project>/<page>`. A new page is a **draft**: its link shows “not found” until you make it public.

## Links

Up to 10 links, in the order you set: drag a row by its handle, or use the arrows. Each link is one of:

| Site | Notes |
|---|---|
| Google | Use **Get your Google review link** (below) |
| Trustpilot, Yelp, Facebook, G2, Capterra, Tripadvisor, App Store, Google Play | Paste the address of your page's review form |
| Custom link | Any other site |
| Plaudit form | One of this project's forms. The link follows the form if you change its address |

The button text defaults to “Review us on Google” and so on; type your own to change it. Links must be full web addresses starting with `https://` (or `http://`); anything else is refused.

The icons are simple lettermarks of our own, not the sites' logos.

### Your Google review link

Under a Google link, **Get your Google review link** turns what you paste into a link that opens Google's “write a review” box:

- a **Place ID** (it starts with `ChIJ…`), or
- a Google Maps link that includes one (links from **Share** in Google Maps often do), or
- a `g.page/r/…/review` link, which is kept as it is.

Short `maps.app.goo.gl` links can't be read without following them: open the link, then copy the full address from your browser's address bar. If the link has no Place ID, look it up with Google's Place ID finder.

If your server has a `GOOGLE_PLACES_API_KEY` (your own Google Cloud key with **Places API (New)** enabled), you can also **search for the business** by name and town. The search runs on your server; the key never reaches the browser. Without a key it's paste only, and the editor says so.

## Look

Logo (the page's own, or else your project's; without either, your project's initial), background, text, button and button-text colours, the button style (solid, outline or soft) and the corner radius. Empty text colours pick a readable one, and low-contrast choices are flagged.

The preview on the right is the real page with your unsaved changes, at phone, tablet or desktop width.

## Every visitor sees every link

There is no rating step, and nothing is hidden from anyone. Asking only happy customers for public reviews (“review gating”) breaks Google's and Trustpilot's rules and can get reviews removed. For the same reason the page never mentions a reward: if your wording reads like you're offering something for a review, the editor warns you. Rewards belong to private testimonials collected with a [form](forms.md#rewards).

## Sharing and QR codes

**Share** has the public switch, the link, the page's address and a QR code:

- any colour (dark on white scans best);
- your logo in the centre: the code then uses the strongest error correction, so it still scans;
- sizes for a 3 cm sticker, a 6 cm table card, a 10 cm flyer or a 20 cm poster (300 dpi), or 1024 px for screens;
- PNG or SVG. The SVG carries its print size and the logo, so it works on its own.

Scan it with a phone camera before you print it. If you change the page's address later, the old address keeps working (it redirects), so printed codes stay good. Changing the project's address works the same way.

## Clicks

**Clicks** shows how often each link was pressed, per day, for the last 7, 30 or 90 days. Only a count per link and day is kept: no addresses, devices or cookies. Days are in UTC. A visitor pressing very many links in a few minutes is slowed down, so counts can't be inflated easily.

The public page is plain HTML with no scripts and nothing loaded from other sites, well under 50 KB.
