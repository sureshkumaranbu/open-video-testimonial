# Theming

Plaudit's public pages are built with [Tailwind CSS v4](https://tailwindcss.com) and [shadcn/ui](https://ui.shadcn.com) conventions, and their colours come from a small set of CSS variables (tokens). Changing a theme never needs a code change, only a setting or one CSS block.

Phase 1 covers the home page (`/`). The dashboard, collection forms and walls keep their own styles (`src/app/globals.css`) for now and don't change with the theme.

## Pick a theme

Set `PLAUDIT_THEME` and restart:

```bash
PLAUDIT_THEME=tomato
```

| Theme | Light | Dark |
|---|---|---|
| `violet` (default) | `#5b3df5` | `#8f78ff` |
| `tomato` | `#c8331a` | `#ff6a4d` |
| `teal` | `#0b7a6c` | `#2fd1bd` |
| `ink` | `#1b1530` | `#f1eefc` |

An unknown name falls back to `violet`. The server puts the theme on `<html data-theme="…">`.

To try a theme without changing the setting, add `?theme=<name>` to the home page's address, for example `/?theme=teal`. Only the names above are accepted; anything else is ignored.

### Light and dark

Visitors choose light, dark or "system" (the default, which follows their device) with the toggle in the header, the menu on phones, or the footer. The choice is kept in their browser (`localStorage`, key `plaudit-mode`) and applied by a tiny script before the page paints, so there's no flash of the wrong colours. Dark mode is a `dark` class on `<html>`.

## Add a theme

1. In `src/app/theme.css`, copy one of the `[data-theme="…"]` blocks and give it a new name. A theme sets only the brand tokens: `--primary`, `--primary-foreground` (text on the primary colour) and `--ring` (focus rings), with the dark values in the nested `&:is(.dark, .dark *)` block.
2. Add the name to `THEMES` in `src/lib/themes.ts`, which validates `PLAUDIT_THEME` and `?theme=`.
3. Check contrast: body text on `--primary` and `--primary` on the page background must both reach 4.5:1, in light and dark. The home page's axe test (`e2e/coverage.spec.ts`) checks the theme the suite runs with; preview yours with `?theme=` and an accessibility checker.

`tests/themes.test.ts` fails if a theme in the list has no block, or a block lacks its dark variant.

## The tokens

All in `src/app/theme.css`, named as shadcn/ui names them, so shadcn components work unchanged:

- `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`
- `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`
- `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`
- `--border`, `--input`, `--ring`, `--radius`
- Plaudit's own: `--tint-1` to `--tint-5` (the testimonial tiles: lavender, mint, peach, butter, sky; deep versions in dark mode), `--star` and `--star-off`.

`@theme inline` maps them to Tailwind utilities (`bg-primary`, `text-muted-foreground`, `bg-tint-3`, `rounded-xl`…).

The neutral tokens are set on `.ui-home` (the themed page's wrapper) and on the document root while such a page is showing, not on every `:root`: the dashboard's `globals.css` already uses `--accent` for something else. Putting the `ui-home` class on another page's wrapper gives it the same tokens and utilities.

## Change the corners

`--radius` (default `22px`) drives every rounded corner: `rounded-xl` is `--radius`, and `sm`, `md`, `lg` and `2xl` are fractions or multiples of it. Buttons stay pills. For sharper cards set it lower in the neutral block, for example `--radius: 6px` (sharp) or `14px` (soft).

## Change the fonts

The display and interface face is [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque), loaded in `src/app/page.tsx` with `next/font/google`. Next.js downloads it at build time and serves it from your own server, so visitors never contact Google.

To use another face, swap the `Bricolage_Grotesque` import in `src/app/page.tsx` for another `next/font/google` (or `next/font/local`) font and keep `variable: "--font-bricolage"`, or rename that variable in `src/app/page.tsx`, `src/app/home.css` and `--font-display` in `src/app/theme.css`.

## How it stays out of the dashboard's way

- Tailwind's preflight reset isn't loaded. The home page has its own base styles in `src/app/home.css`.
- Utilities are generated only from the home page's files and `src/components/ui` (`@source` in `theme.css`), and every one is scoped as `:where(.ui-home) .class`, so a dashboard class that happens to share a name with a utility (`.container`, `.block`, `.hidden`) is untouched.
- Tailwind's default theme is cleared, so no utility reads a dashboard variable such as `--text-sm`.

New shadcn/ui components go in `src/components/ui/` (`components.json` is set up for the CLI). Add only what a page uses.
