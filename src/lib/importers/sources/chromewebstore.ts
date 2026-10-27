import { savedPageSource } from "./_saved";

/**
 * Chrome Web Store: a saved copy of your extension's reviews page only.
 * Google offers no API for store reviews, so Plaudit reads the page you save.
 */
export const chromewebstore = savedPageSource({
  id: "chromewebstore",
  label: "Chrome Web Store",
  tosNotes:
    "Google has no API for Chrome Web Store reviews and its pages load them as you scroll, so Plaudit never visits the store. Open your extension’s Reviews tab, scroll until the ones you want are showing, save the page and upload it. Import only your own extension’s reviews.",
});
