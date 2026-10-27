# Widgets

_On by default (the `widgets` section; `PLAUDIT_FEATURES` can turn it off). Without it the **Widgets** tab is hidden; embeds that use your project's slug (`data-project`) work the same either way._

A widget shows your approved testimonials on your own site. Make as many as you like, one per page or purpose, from the project's **Widgets** tab.

## The list

Each widget has a name, a layout and, if you said, the page it's for. **Edit** opens the studio, **Embed** opens its Share tab, **Duplicate** makes a copy, and **Delete** removes it: pages that still embed it then show nothing rather than an error.

When you make a widget, say where it goes and Plaudit suggests a layout: a rating badge or carousel for a pricing page, a toast or badge at checkout, a marquee or grid on the home page.

## Layouts

| Layout | What it is |
|---|---|
| Masonry grid | Columns of cards of any height (1 to 4 columns) |
| List | One readable column |
| Carousel | One testimonial at a time, with arrows, dots and optional autoplay |
| Multi-card slider | Up to 4 cards side by side that slide one at a time; fewer on narrow screens |
| Marquee | 1 to 3 rows that scroll on their own at the speed and in the direction you choose |
| Single featured | One testimonial, large |
| Rating badge | Your average rating and count, linking to your wall of love |
| Floating toast | A small card in a corner of the page, one testimonial after another; hidden on phones if you like, and gone for the rest of the visit once closed |

Switch layouts at any time: your picks, design and labels stay.

Everything that moves pauses on hover and while keyboard focus is inside it, has a pause button, and stays still for visitors who ask for reduced motion.

## Studio

The left side has six tabs; the right side is a live preview that runs the real embed code with your unsaved changes, at desktop, tablet or phone width, over a light or dark page. **Save changes** updates every page that embeds the widget within a minute.

- **Testimonials.** *Automatic* shows every approved testimonial that matches the filters, new ones included. *Hand-picked* shows only the ones you pick, in your order (use the arrows to reorder). **Pin** puts one at the top in either mode. Filters: tags (any or all), lowest rating, sources, kind (text, video, with images), words it must or mustn't mention, language, form, how many, and the order (newest, oldest, highest rated, inbox pins, or shuffled on each visit). Filters apply to hand-picked ones too, and changing them never loses your picks.
- **Design.** Light, dark or matching the visitor; a font; colours for the accent, text, names, small print, stars, cards, borders and background (empty means the default, or transparent for the background); corner radius, spacing, most width and shadow; and what to show: rating, source icon (linking to the original review), photo or initials, job title and company, headline, images, video, highlights, a "Verified" mark for testimonials sent through your forms, the date (as a date or "3 days ago"), "Read more" after so many characters, and first names only.
- **Settings.** The name and page it's for, the layout's own options (columns; arrows, dots, autoplay and seconds per slide; cards side by side; marquee rows, speed and direction; toast corner, delay, duration and phones), lazy loading, the **rating summary** (average and count above the testimonials, for this widget's testimonials or all approved ones), and a **Leave a testimonial** button that opens one of your forms as a page or a pop-up.
- **Labels.** Every word visitors see, so the widget can match your site's language.
- **Share.** The script, iframe, hosted link, React component and SEO include, an email with all of them for your developer, and steps for common site builders. See [`docs/EMBED.md`](../EMBED.md#saved-widgets).

## Privacy

Widgets show approved testimonials only, and a withdrawn one disappears at once. The feed never includes email addresses, phone numbers, consent records, custom or hidden fields, and with **first name only** the surname never leaves your server. Plaudit doesn't look up avatars on outside services.
