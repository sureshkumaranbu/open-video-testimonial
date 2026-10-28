# Plaudit widget on WordPress

The [Plaudit plugin](../help/wordpress.md) adds a block, `[plaudit]` shortcodes, SEO mode and a site-wide toast. Without it, a Custom HTML block works too.

Get the snippet from **Widgets › your widget › Share** in the dashboard. Replace `https://plaudit.example` and `w_abc123def456` below with your own server and widget id.

1. Edit the page and add a **Custom HTML** block where the widget should go.
2. Paste the script snippet:

```html
<script src="https://plaudit.example/widget.js" data-widget="w_abc123def456" async></script>
```

3. Update the page. In the classic editor, switch to the **Text** tab first.

Page builders (Elementor, Divi and the like) have an HTML or Code element that works the same way.

For search engines, a theme or plugin can fetch `https://plaudit.example/api/widget/w_abc123def456/html` on the server and print it (see [the SEO include](../EMBED.md#seo-html-include)).
