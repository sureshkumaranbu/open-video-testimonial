# Theming

Plaudit's public pages are built with [Tailwind CSS v4](https://tailwindcss.com) and [shadcn/ui](https://ui.shadcn.com) conventions, and their colours come from a small set of CSS variables (tokens). Changing a theme never needs a code change, only a setting or one CSS block.

The home page (`/`) and the dashboard (`/admin`, sign-in included) follow the theme. Collection forms, walls and embeds keep their own styles (`src/app/globals.css`) and each project's own colours; they don't change with the theme.

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

An unknown name falls back to `violet`. The server puts the theme on `<html data-brand="…">`. (It isn't `data-theme`: across the app that attribute already means light or dark, on walls, embeds, forms and widget snippets.)

To try a theme without changing the setting, add `?theme=<name>` to the home page's address, for example `/?theme=teal`. Only the names above are accepted; anything else is ignored.

### Light and dark

Visitors choose light, dark or "system" (the default, which follows their device) with the toggle in the header, the menu on phones, or the footer. In the dashboard the same choice sits at the bottom of the sidebar (or in the menu on phones). It's one setting for both: kept in the browser (`localStorage`, key `plaudit-mode`) and applied by a tiny script before the page paints (`src/app/_home/boot.ts`, `src/app/admin/_shell/boot.ts`), so there's no flash of the wrong colours. Dark mode is a `dark` class on `<html>`.

`data-theme="light|dark"` keeps its own meaning on walls, embeds, forms and widget snippets: the light or dark look a project picked for its public pages, which the dashboard's mode never changes.

## Add a theme

1. In `src/app/theme.css`, copy one of the `[data-brand="…"]` blocks and give it a new name. A theme sets only the brand tokens: `--primary`, `--primary-foreground` (text on the primary colour) and `--ring` (focus rings), with the dark values in the nested `&:is(.dark, .dark *)` block.
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

## The dashboard

Every dashboard page is wrapped in `.admin-root` (`src/app/admin/layout.tsx`). Inside it, `src/app/globals.css` derives the dashboard's own tokens from the theme's:

| Dashboard token | From |
|---|---|
| `--paper`, `--paper-2` | `--background`, `--muted` |
| `--surface`, `--surface-2` | `--card`, `--background` |
| `--ink`, `--ink-2` | `--foreground`, `--muted-foreground` |
| `--line`, `--line-strong` | `--border`, `--input` |
| `--accent`, `--on-accent` | `--primary`, `--primary-foreground` (the brand) |
| `--focus` | `--ring` |
| `--radius-sm` … `--radius-xl` | fractions of `--radius` (20px in the dashboard) |
| `--font-ui` | Bricolage Grotesque |

So a theme, or light/dark, changes every dashboard page at once. Status colours (`--ok`, `--warn`, `--danger`, `--info`, `--rec`, `--star`, `--highlight`) stay semantic; the dashboard uses a slightly deeper `--ok` in light mode and lighter status colours in dark mode so their text keeps 4.5:1. A project's own colour still overrides `--accent` where a page shows it (its cards and previews), as on the public pages; the dashboard's own buttons use the brand.

Previews of public pages inside the dashboard (the form builder's form, the wall editor's wall) reset to the public tokens, so they look exactly like what customers see. `tests/theme-parity.test.ts` checks the reset matches.

The shell (sidebar, top bar, phone menu: `src/app/admin/_shell/`), the dashboard home (`src/app/admin/page.tsx`, `src/app/admin/_dash/`) and the sign-in pages are built with Tailwind utilities, scoped to `.ui-app` the way the home page's are scoped to `.ui-home`. Older dashboard markup never sits inside a `.ui-app`, so a utility can't change a page that wasn't redesigned. The sidebar's collapsed state is remembered in `localStorage` (`plaudit-sidebar`).

## Change the corners

`--radius` (default `22px`) drives every rounded corner: `rounded-xl` is `--radius`, and `sm`, `md`, `lg` and `2xl` are fractions or multiples of it. Buttons stay pills. For sharper cards set it lower in the neutral block, for example `--radius: 6px` (sharp) or `14px` (soft).

## Change the fonts

The display and interface face is [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque), loaded in `src/app/fonts.ts` with `next/font/google` and used by the home page and the dashboard. Next.js downloads it at build time and serves it from your own server, so visitors never contact Google.

To use another face, swap the `Bricolage_Grotesque` import in `src/app/fonts.ts` for another `next/font/google` (or `next/font/local`) font and keep `variable: "--font-bricolage"`, or rename that variable there, in `src/app/home.css`, in `--font-ui` in `src/app/globals.css` and in `--font-display` in `src/app/theme.css`.

## How it stays out of other pages' way

- Tailwind's preflight reset isn't loaded. The home page has its own base styles in `src/app/home.css`, and the dashboard's redesigned parts theirs in `src/app/admin/app.css`.
- Utilities are generated only from the files listed with `@source` in `theme.css` (the home page, the dashboard's shell, home and sign-in pages, and `src/components/ui`), and every one is scoped as `:where(.ui-home, .ui-app) .class`, so a dashboard class that happens to share a name with a utility (`.container`, `.block`, `.hidden`) is untouched.
- Tailwind's default theme is cleared, so no utility reads a dashboard variable such as `--text-sm`.
- The theme's tokens apply only under `.ui-home` and `.admin-root`; public pages keep `:root`'s palette.

New shadcn/ui components go in `src/components/ui/` (`components.json` is set up for the CLI). Add only what a page uses.
