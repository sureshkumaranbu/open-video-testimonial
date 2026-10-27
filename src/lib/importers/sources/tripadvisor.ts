import { savedPageSource } from "./_saved";

/**
 * Tripadvisor: a saved copy of your listing's reviews only. Its terms
 * forbid automated collection (its Content API is for approved partners and
 * shares five reviews), so Plaudit reads the page you save.
 */
export const tripadvisor = savedPageSource({
  id: "tripadvisor",
  label: "Tripadvisor",
  tosNotes:
    "Tripadvisor’s terms don’t allow automated collection, and its Content API is only for approved partners, so Plaudit never visits Tripadvisor. Open your listing with the reviews showing, save the page and upload it. Import only your own listing’s reviews.",
});
