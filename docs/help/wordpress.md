# Plaudit on WordPress

The Plaudit plugin puts your saved widgets and forms on a WordPress site with a block or a shortcode, adds a site-wide toast if you want one, and puts each widget's testimonials in the page as HTML so search engines read them. It's in the repository at [`integrations/wordpress/plaudit/`](../../integrations/wordpress/plaudit/). It isn't in the WordPress.org directory yet, so you install it from a zip.

Without the plugin, a **Custom HTML** block with the widget's script works too ([embeds/wordpress.md](../embeds/wordpress.md)).

## Install

1. Zip the `plaudit` folder (`cd integrations/wordpress && zip -r plaudit.zip plaudit`).
2. In WordPress, **Plugins › Add New › Upload Plugin**, choose the zip, then **Activate**.
3. Open **Settings › Plaudit**:
   - **Plaudit address**: your server, for example `https://plaudit.example.com`.
   - **API key** (optional): a **read-only** key from Plaudit's **Settings › API keys**. With it, the block lists your widgets and forms by name. It's kept in WordPress's options and used only by your WordPress server; visitors' browsers never get it.
4. Press **Test connection**. It lists the projects the key can see.

## The block

Add **Plaudit testimonials**, choose **A saved widget** or **A collection form**, and pick one (or paste a widget id, such as `w_abc123def456`, from **Widgets › your widget › Share**). The editor shows a placeholder; the widget appears on the published page. In the block's sidebar: **HTML for search engines** for a widget, and the starting height for a form.

## Shortcodes

For the classic editor, page builders and theme files:

| Shortcode | What it shows |
|---|---|
| `[plaudit widget="w_abc123def456"]` | A saved widget |
| `[plaudit widget="w_abc123def456" seo="0"]` | The same, without its HTML for search engines |
| `[plaudit form="acme/stories"]` | A form: the project's slug, a slash, the form's slug. Or `form="stories" project="acme"` |
| `[plaudit form="acme/stories" height="720" title="Tell us about your trip"]` | A form's starting height in pixels, and the frame's accessible name |

Page builders (Elementor, Divi, Beaver Builder and the like) take shortcodes in their Shortcode or Text element.

Something wrong with a shortcode (a mistyped id, no address in the settings)? Editors see a dashed note saying what to fix; visitors see nothing.

## Site-wide toast

In **Settings › Plaudit**, put a widget id under **Site-wide toast** and it shows on every page. Use a widget with the **toast** layout, which pops up in a corner. Clear the field to remove it.

## Search engines (SEO mode)

On by default. For each widget, your WordPress server fetches its [HTML include](../EMBED.md#seo-html-include) (with review markup) from Plaudit and puts it inside the widget's placeholder, where search engines read it. The live widget then draws over it. The HTML is kept for 10 minutes (**Keep that HTML for**), and a slow or unreachable Plaudit server is skipped quickly, so pages still load.

## Caching and optimisation plugins

`widget.js` reads its own script tag to know which widget to draw, so it has to stay a separate file. Exclude it from combining, minifying and delaying JavaScript in WP Rocket, Autoptimize, LiteSpeed Cache, W3 Total Cache, SiteGround Optimizer, Perfmatters or FlyingPress. If a form doesn't show, exclude iframes containing `/embed/` from iframe lazy-loading. The plugin's `readme.txt` has the exact setting for each.

Full-page caching is fine: the live widget always fetches fresh testimonials (Plaudit caches them for up to a minute).
