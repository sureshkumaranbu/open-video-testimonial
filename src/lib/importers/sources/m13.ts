import type { AdapterId, ImporterAdapter } from "../types";
import { airbnb } from "./airbnb";
import { amazon } from "./amazon";
import { applepodcasts } from "./applepodcasts";
import { appsumo } from "./appsumo";
import { chromewebstore } from "./chromewebstore";
import { clutch } from "./clutch";
import { etsy } from "./etsy";
import { facebook } from "./facebook";
import { feefo } from "./feefo";
import { fiverr } from "./fiverr";
import { linkedin } from "./linkedin";
import { realtor } from "./realtor";
import { reddit } from "./reddit";
import { shopify } from "./shopify";
import { tripadvisor } from "./tripadvisor";
import { trustindex } from "./trustindex";
import { udemy } from "./udemy";
import { woocommerce } from "./woocommerce";
import { wordpress } from "./wordpress";
import { yelp } from "./yelp";
import { youtube } from "./youtube";
import { zillow } from "./zillow";

/** The P1 sources (PRD §8.2) added in M13, listed while the imports2 flag is on. */
export const M13_ADAPTERS = {
  yelp,
  facebook,
  linkedin,
  youtube,
  reddit,
  tripadvisor,
  appsumo,
  udemy,
  shopify,
  woocommerce,
  etsy,
  amazon,
  clutch,
  fiverr,
  airbnb,
  zillow,
  realtor,
  chromewebstore,
  wordpress,
  applepodcasts,
  feefo,
  trustindex,
} satisfies Partial<Record<AdapterId, ImporterAdapter>>;
