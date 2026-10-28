# @plaudit/react

React components for [Plaudit](https://github.com/sureshkumaranbu/open-video-testimonial), the open-source, self-hostable testimonial app:

- **`PlauditWidget`**: a saved widget (wall of testimonials, carousel, badge…), drawn by your Plaudit server's `widget.js`.
- **`PlauditForm`**: a collection form, as the iframe embed (it can use the camera).
- **`fetchWidgetHtml`**: the widget's server-rendered HTML, for SEO mode.

They work with React 18 and 19, in Next.js (App Router and Pages Router), Remix, Astro islands, Vite and anything else that renders React. They're SSR-friendly: on the server they render only a placeholder (or the iframe), and nothing runs until the browser has the page.

> **Not on npm yet.** Publishing needs the project owner's npm account, so for now build it from this folder (`npm run build`, then `npm pack`) or copy `src/` into your app. `"private": true` in package.json stops an accidental publish; remove it when publishing.

## A saved widget

Get the widget id from **Widgets › your widget › Share** in the Plaudit dashboard.

```tsx
import { PlauditWidget } from "@plaudit/react";

export function Reviews() {
  return <PlauditWidget server="https://plaudit.example.com" id="w_abc123def456" />;
}
```

The server render is an empty `<div data-plaudit-widget>`. In the browser the component adds `<script src="https://plaudit.example.com/widget.js" data-widget="…" data-target="#…" async>`, and the widget draws inside its own shadow root, so your CSS doesn't change it. Unmounting removes the script; changing `id` mounts a fresh widget.

### SEO mode

Search engines and readers without JavaScript get the testimonials as real HTML when you fetch the widget's [HTML include](../../docs/EMBED.md#seo-html-include) on your server and pass it in:

```tsx
// app/page.tsx (a Next.js server component)
import { fetchWidgetHtml, PlauditWidget } from "@plaudit/react";

export default async function Page() {
  const html = await fetchWidgetHtml("https://plaudit.example.com", "w_abc123def456", {
    jsonLd: true, // adds Review and AggregateRating JSON-LD
    init: { next: { revalidate: 300 } },
  });
  return <PlauditWidget server="https://plaudit.example.com" id="w_abc123def456" html={html} />;
}
```

The HTML sits inside the placeholder; when `widget.js` loads, the live widget draws over it. `fetchWidgetHtml` answers `""` when the server can't be reached (5 seconds by default, `timeoutMs` to change it), so the page still renders.

## A collection form

```tsx
import { PlauditForm } from "@plaudit/react";

<PlauditForm
  server="https://plaudit.example.com"
  project="acme"
  form="stories"
  params={{ name: user.name, utm_source: "app" }}
  onSubmitted={() => console.log("Thank you!")}
/>;
```

| Prop | Default | What it does |
|---|---|---|
| `server`, `project`, `form` | | Your Plaudit server, the project's slug and the form's slug (Forms › your form › Share) |
| `params` | | Prefilled and hidden fields, added to the form's address |
| `title` | "Share your experience" | The frame's accessible name |
| `minHeight` | 640 | Height in px until the form reports its own |
| `autoResize` | `true` | Grow the frame with each step |
| `onSubmitted` | | Called when a testimonial is sent |

Only messages from your Plaudit server's origin and from this frame are listened to.

## Content Security Policy

If your site sends a CSP, allow your Plaudit server in `script-src` and `connect-src` (the widget), `img-src` and `media-src` (photos and videos), and `frame-src` (the form).

## Building

```bash
npm install   # in the Plaudit repository root, for React and TypeScript
cd packages/react && npm run build
```

`tsc` writes ES modules and type declarations to `dist/`. The repository's `npm test` runs this package's tests (`tests/react-package.test.ts`).

## Licence

MIT. See [LICENSE](LICENSE).
