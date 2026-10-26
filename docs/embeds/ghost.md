# Plaudit widget on Ghost

Get the snippet from **Widgets › your widget › Share** in the dashboard. Replace `https://plaudit.example` and `w_abc123def456` below with your own server and widget id.

1. In the post or page editor, add an **HTML** card.
2. Paste the script snippet:

```html
<script src="https://plaudit.example/widget.js" data-widget="w_abc123def456" async></script>
```

3. To show it on every page, put it in **Settings › Code injection** with `data-target` pointing at an element in your theme.
