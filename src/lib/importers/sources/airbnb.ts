import { savedPageSource } from "./_saved";

/** Airbnb: a saved copy of your listing or host profile only (Airbnb forbids automated collection). */
export const airbnb = savedPageSource({
  id: "airbnb",
  label: "Airbnb",
  tosNotes:
    "Airbnb’s terms forbid automated collection, so Plaudit never visits Airbnb. Open your listing’s reviews (or your host profile), scroll until the ones you want are showing, save the page and upload it. Import only reviews of your own listings.",
});
