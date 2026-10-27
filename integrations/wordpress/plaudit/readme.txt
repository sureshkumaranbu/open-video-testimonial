=== Plaudit Testimonials ===
Contributors: plaudit
Tags: testimonials, reviews, video testimonials, wall of love, social proof
Requires at least: 6.3
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Show video and text testimonials from your own Plaudit server: saved widgets, collection forms and a site-wide toast, with HTML for search engines.

== Description ==

Plaudit is a free, open-source testimonial app you host yourself. This plugin puts what you collect there on your WordPress site:

* **A block and a shortcode** for any saved widget (grid, list, carousel, slider, marquee, featured, badge or toast) and for your collection forms.
* **Search engines see your testimonials.** In SEO mode each widget's testimonials are also in the page as plain HTML, with review markup (JSON-LD), cached for a few minutes.
* **A site-wide toast**: one widget on every page, from the settings.
* **Your API key stays on your server.** It's used only from PHP, to list your widgets and forms in the block editor. Visitors' browsers only ever load your Plaudit server's public widget and form.

You need a Plaudit server. See https://github.com/sureshkumaranbu/open-video-testimonial to run one.

= Shortcodes =

* `[plaudit widget="w_abc123def456"]` a saved widget. Add `seo="0"` to leave out its HTML for search engines.
* `[plaudit form="acme/stories"]` (or `form="stories" project="acme"`) a collection form. `height="720"` sets its starting height, `title="…"` its accessible name.

Get the ids from Plaudit: **Widgets › your widget › Share**, and **Forms › your form › Share**.

= Caching and optimisation plugins =

The widget script reads its own tag (`data-widget`) to know what to draw, so it must stay a separate file:

* **WP Rocket**: add `/widget.js` to File Optimization › Excluded JavaScript Files (and to "Delay JavaScript execution" exclusions if testimonials appear only after a click).
* **Autoptimize**: add `widget.js` to "Exclude scripts from Autoptimize".
* **LiteSpeed Cache**: add `widget.js` to Page Optimization › JS Excludes and JS Deferred / Delayed Excludes.
* **W3 Total Cache**: leave `widget.js` out of JS minify groups.
* **SiteGround Optimizer, Perfmatters, FlyingPress**: exclude `widget.js` from combining and delaying.
* **Lazy-loading for iframes**: if a form doesn't appear, exclude iframes whose address contains `/embed/` from your plugin's iframe lazy-loading.

Full-page caches are fine: the SEO HTML is cached by this plugin for the minutes you set (10 by default), and the live widget always loads fresh testimonials (your Plaudit server caches them for up to a minute).

= Privacy =

The plugin itself sets no cookies and sends nothing about your visitors anywhere. Visitors' browsers load the widget and form from your own Plaudit server, which counts widget views without cookies (see its analytics help page). Your server fetches the SEO HTML from your Plaudit server.

== Installation ==

1. Upload the `plaudit` folder to `/wp-content/plugins/`, or upload the zip under Plugins › Add New › Upload.
2. Activate it.
3. Open **Settings › Plaudit**, enter your Plaudit address (for example `https://plaudit.example.com`) and, optionally, a **read-only** API key from Plaudit › Settings › API keys.
4. Press **Test connection**.
5. Add the "Plaudit testimonials" block to a page, or a shortcode.

== Frequently Asked Questions ==

= Do I need an API key? =

No. Widgets and forms work with just the address. The key lets the block editor list your widgets and forms by name. Use a read-only key.

= Will the widget slow my pages down? =

The widget script is small (about 7 KB compressed), loads asynchronously, and draws in its own shadow root, so your theme's CSS can't break it and it can't break your theme.

= Why does the toast show on every page? =

That's what the site-wide toast setting is for. Clear the field to remove it.

== Changelog ==

= 0.1.0 =
* First version: settings with a connection test, the block, the shortcode, SEO mode with caching and the site-wide toast.
