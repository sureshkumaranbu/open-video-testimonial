# Plaudit for WordPress (developer notes)

The plugin is in [`plaudit/`](plaudit/); its user-facing documentation is [`plaudit/readme.txt`](plaudit/readme.txt), in the WordPress.org format. It's GPL-2.0-or-later, as WordPress.org requires (the rest of Plaudit is MIT).

- `plaudit.php`: the shortcode, the block's PHP render, the site-wide toast.
- `includes/render.php`: building the embeds. Values are escaped with `esc_url` and `esc_attr`; the SEO include goes through `wp_kses` and its JSON-LD is re-encoded.
- `includes/settings.php`: **Settings › Plaudit** (Settings API, so `options.php` checks the nonce and `manage_options`) and **Test connection** (its own nonce and capability check).
- `includes/rest.php`: `GET /wp-json/plaudit/v1/embeds` for the block editor (`edit_posts` only), which calls Plaudit with the saved key on the server.
- `blocks/embed/`: the block, plain JavaScript with a hand-written `index.asset.php`, so there is no build step.

## Packaging

```bash
cd integrations/wordpress
zip -r plaudit.zip plaudit
```

Upload `plaudit.zip` under Plugins › Add New › Upload. `tests/` stays out of the zip.

## Checks

`tests/integrations.test.ts` runs `php -l` on every file and `tests/render-harness.php` (WordPress functions stood in by simple versions) when PHP is installed; it's skipped otherwise, and CI doesn't install PHP. The plugin hasn't been run in a real WordPress yet, so "Tested up to" in readme.txt is what it was written against. WordPress.org submission needs the owner's account; run the [Plugin Check](https://wordpress.org/plugins/plugin-check/) plugin first.
