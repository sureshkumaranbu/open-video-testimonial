# Embedding a form

_Forms are behind the `forms` preview flag. The builder's **Share** tab gives you each snippet with your own addresses filled in._

The form always runs inside an iframe served by your Plaudit server (`/embed/<project>/form/<form>`), so your site's CSS can't break it and it can use the camera. That path is the only one other sites may frame; `/f/…` pages refuse to be framed.

## Inline

```html
<div data-plaudit-form="stories" data-project="acme"></div>
<script src="https://your-plaudit.example/form.js" async></script>
```

The form appears where the `<div>` is and grows to fit each step. Parameters on your page's own address (`?utm_source=…`, `?name=…`, `?r=…`) are passed on to the form.

## Popup button

```html
<div data-plaudit-form="stories" data-project="acme" data-mode="popup" data-label="Share your experience"></div>
<script src="https://your-plaudit.example/form.js" async></script>
```

A floating button opens the form in a dialog. `data-color` sets the button colour. Escape, the close button or a click outside closes it.

## Iframe

For site builders that only accept an iframe:

```html
<iframe src="https://your-plaudit.example/embed/acme/form/stories" title="Share your experience"
  allow="camera; microphone; clipboard-write" style="width:100%;border:0;min-height:640px"></iframe>
```

Keep the `allow` attribute: without it the browser blocks the camera inside the frame.

## Messages to your page

The embedded form posts these to the page around it (with `postMessage`; nothing private is ever included):

| `type` | When | Also |
|---|---|---|
| `plaudit:form-resize` | Its height changes | `form` (id), `slug`, `height` in px |
| `plaudit:form-submitted` | A testimonial was sent | `form`, `slug` |
| `plaudit:form-close` | Escape was pressed inside it | `form`, `slug` |

With `form.js`, the `<div>` also fires a `plaudit:submitted` event (`event.detail.form` is the form's slug):

```js
document.querySelector("[data-plaudit-form]").addEventListener("plaudit:submitted", () => {
  // e.g. show your own thank-you, or send an analytics event
});
```
