import { savedPageSource } from "./_saved";

/**
 * Yelp: a saved copy of your business page only. Yelp's terms forbid
 * automated collection and its API shares just three short excerpts, so
 * Plaudit never fetches Yelp; it reads the review data in the page you save.
 */
export const yelp = savedPageSource({
  id: "yelp",
  label: "Yelp",
  tosNotes:
    "Yelp’s terms don’t allow automated collection, and its API shares only three short excerpts, so Plaudit never visits Yelp. Open your business page with the reviews showing, save it, and upload it here. Import only your own business’s reviews.",
});
