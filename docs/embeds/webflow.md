# Plaudit widget on Webflow

Get the snippet from **Widgets › your widget › Share** in the dashboard. Replace `https://plaudit.example` and `w_abc123def456` below with your own server and widget id.

1. Drag an **Embed** element onto the page.
2. Paste the script snippet and save:

```html
<script src="https://plaudit.example/widget.js" data-widget="w_abc123def456" async></script>
```

3. Publish the site. The designer canvas doesn't run scripts, so the widget shows on the published page.
