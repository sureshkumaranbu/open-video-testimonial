# Plaudit widget as a React component

Get the snippet from **Widgets › your widget › Share** in the dashboard. Replace `https://plaudit.example` and `w_abc123def456` below with your own server and widget id.

For a server-rendered app (Next.js, Remix) or SEO mode, use the `PlauditWidget` and `PlauditForm` components in [`packages/react/`](../../packages/react/README.md) (`@plaudit/react`, not on npm yet). For a quick start, a copy-paste component: save it as `PlauditWidget.jsx`:

```jsx
import { useEffect, useRef } from "react";

export function PlauditWidget({ id }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.id = "plaudit-" + id;
    const s = document.createElement("script");
    s.src = "https://plaudit.example/widget.js";
    s.async = true;
    s.dataset.widget = id;
    s.dataset.target = "#plaudit-" + id;
    document.body.appendChild(s);
    return () => s.remove();
  }, [id]);
  return <div ref={ref} />;
}
```

The Share tab gives you this with your server's address and widget id filled in. The widget draws into its own shadow root, so your app's CSS doesn't affect it.
