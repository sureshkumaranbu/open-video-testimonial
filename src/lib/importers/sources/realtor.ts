import { savedPageSource } from "./_saved";

/** Realtor.com: a saved copy of your agent profile only (its terms forbid automated collection). */
export const realtor = savedPageSource({
  id: "realtor",
  label: "Realtor.com",
  tosNotes:
    "Realtor.com’s terms forbid automated collection, so Plaudit never visits it. Open your agent profile with the reviews showing, save the page and upload it. Import only your own reviews.",
});
