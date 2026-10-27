# Plaudit widget on Shopify

Get the snippet from **Widgets › your widget › Share** in the dashboard. Replace `https://plaudit.example` and `w_abc123def456` below with your own server and widget id.

1. Open **Online Store › Themes › Customize**.
2. Add a **Custom Liquid** section (or block) where the widget should go.
3. Paste the script snippet and save:

```html
<script src="https://plaudit.example/widget.js" data-widget="w_abc123def456" async></script>
```

