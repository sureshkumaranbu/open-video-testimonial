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

# Saved widgets

_Saved widgets are behind the `widgets` preview flag. The studio's **Share** tab gives you each snippet with your own server and widget id filled in; [`docs/embeds/`](embeds/README.md) has steps for WordPress, Webflow, Framer, Wix, Squarespace, Shopify, Ghost, Notion and Next.js._

A saved widget has an id like `w_abc123def456`. Change its layout, look or testimonials in the studio and every page that embeds it follows (the feed may be cached for up to a minute).

## Script

```html
<script src="https://plaudit.example/widget.js" data-widget="w_abc123def456" async></script>
```

It renders right after the script tag, or into the element `data-target` names. The widget draws in its own shadow root, so your site's CSS can't change it. Grid and list are built into `widget.js` (under 7 KB gzipped); the other layouts load a small file from `/widget/<layout>.js` the first time they're used.

Carousels and sliders pause while the pointer is over them or keyboard focus is inside them, move with the arrow keys and have a pause button. Visitors who ask their system for reduced motion get no autoplay and a still marquee. Videos load only when played and keep their captions.

## Iframe

```html
<iframe src="https://plaudit.example/embed/w_abc123def456" title="Testimonials" loading="lazy" style="width:100%;border:0;min-height:320px" data-plaudit-frame="w_abc123def456"></iframe>
```

The Share tab adds a few lines of script that grow the frame to fit: the page posts `{type: "plaudit:resize", slug: "w_abc123def456", height}` to its parent.

## Hosted link

`https://plaudit.example/embed/w_abc123def456` is a page of its own, for Notion or a link in an email.

## SEO HTML include

`GET https://plaudit.example/api/widget/w_abc123def456/html` returns the widget as plain, escaped HTML with its own scoped styles, so the review text is in your page even with JavaScript off. Fetch it on your server (a PHP include, a static-site build, a Next.js server component) and put it in the page. Add `?jsonld=1` for a `<script type="application/ld+json">` block with up to 10 `Review` entries and an `AggregateRating`. Moving layouts come out as a list; the rating badge as its summary. It is cached for 60 seconds and a deleted widget returns an empty string.

## React

The Share tab has a copy-paste `PlauditWidget` component ([`docs/embeds/react.md`](embeds/react.md)) that adds the script in an effect.
