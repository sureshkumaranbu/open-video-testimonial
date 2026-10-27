import { ogPost } from "./linkedin";
import { savedPageSource } from "./_saved";

/**
 * Facebook: a saved copy of your page's reviews (recommendations), or of one
 * post, only. They're behind a login and Facebook's terms forbid automated
 * collection, so Plaudit reads only the page you save from your own browser.
 */
export const facebook = savedPageSource({
  id: "facebook",
  label: "Facebook",
  tosNotes:
    "Facebook shows recommendations only to people who are signed in, and its terms forbid automated collection, so Plaudit never visits Facebook. Open your page’s Reviews tab, scroll until the ones you want are showing, save the page and upload it. Import only recommendations of your own page.",
  fallback: ogPost,
});
