import { savedPageSource } from "./_saved";

/** Zillow: a saved copy of your agent profile only (Zillow forbids automated collection; its reviews API is for partners). */
export const zillow = savedPageSource({
  id: "zillow",
  label: "Zillow",
  tosNotes:
    "Zillow’s terms forbid automated collection and its reviews API is for approved partners, so Plaudit never visits Zillow. Open your agent profile with the reviews showing, save the page and upload it. Import only your own reviews.",
});
