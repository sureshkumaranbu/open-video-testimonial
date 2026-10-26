# Plaudit widget on Next.js

Get the snippet from **Widgets › your widget › Share** in the dashboard. Replace `https://plaudit.example` and `w_abc123def456` below with your own server and widget id.

Use the React component from the Share tab (see [react.md](react.md)) in a client component:

```tsx
"use client";
import { PlauditWidget } from "./PlauditWidget";

export default function Testimonials() {
  return <PlauditWidget id="w_abc123def456" />;
}
```

For text that search engines see, fetch the SEO include in a server component and render it:

```tsx
export default async function TestimonialsHtml() {
  const html = await fetch("https://plaudit.example/api/widget/w_abc123def456/html?jsonld=1", { next: { revalidate: 300 } }).then((r) => r.text());
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
```

The include is escaped HTML made by your Plaudit server; only include it from a server you run.
