import { env } from "../env";
import { fetchPublicText } from "../net-guard";
import { appstore } from "./sources/appstore";
import { capterra } from "./sources/capterra";
import { g2 } from "./sources/g2";
import { google } from "./sources/google";
import { googleplay } from "./sources/googleplay";
import { producthunt } from "./sources/producthunt";
import { senja } from "./sources/senja";
import { shapo } from "./sources/shapo";
import { testimonialTo } from "./sources/testimonial-to";
import { trustpilot } from "./sources/trustpilot";
import { website } from "./sources/website";
import { x } from "./sources/x";
import { ADAPTER_IDS, type AdapterId, type ImportCtx, type ImporterAdapter, type InputField } from "./types";

/** Every importer, by id. A new source is one line here plus its file in sources/. */
const ADAPTERS: Record<AdapterId, ImporterAdapter> = {
  google,
  trustpilot,
  g2,
  capterra,
  producthunt,
  appstore,
  googleplay,
  x,
  "testimonial-to": testimonialTo,
  senja,
  shapo,
  website: { ...website, unlisted: true },
};

export function isAdapterId(id: unknown): id is AdapterId {
  return typeof id === "string" && (ADAPTER_IDS as readonly string[]).includes(id);
}

export function getAdapter(id: unknown): ImporterAdapter | null {
  return isAdapterId(id) ? ADAPTERS[id] : null;
}

/** What the source picker needs about an importer (client-safe: no functions, no secrets). */
export type ImporterInfo = {
  id: AdapterId;
  label: string;
  platform: string;
  kind: "platform" | "migration";
  method: ImporterAdapter["method"];
  tosNotes: string;
  fields: InputField[];
  /** Takes a saved copy of the page when the site blocks us. */
  acceptsHtml: boolean;
  upload: ImporterAdapter["upload"] | null;
  available: boolean;
  missing?: string;
};

export function listImporters(): ImporterInfo[] {
  return ADAPTER_IDS.map((id) => ADAPTERS[id])
    .filter((a) => !a.unlisted)
    .map((a) => {
      const missing = a.unavailable?.() ?? null;
      return {
        id: a.id,
        label: a.label,
        platform: a.platform,
        kind: a.kind,
        method: a.method,
        tosNotes: a.tosNotes,
        fields: a.fields,
        acceptsHtml: Boolean(a.parseHtml),
        upload: a.upload ?? null,
        available: !missing,
        ...(missing ? { missing } : {}),
      };
    });
}

/**
 * Where an adapter fetches from. Tests point adapters at a local stand-in
 * with IMPORTER_ORIGINS ("appstore=http://…" or "*=http://…/importers",
 * which sends adapter <id> to <base>/<id>); otherwise it's the real site.
 */
export function originFor(id: string, defaultOrigin: string) {
  const map = env.importerOrigins;
  if (map[id]) return map[id];
  if (map["*"]) return `${map["*"]}/${id}`;
  return defaultOrigin;
}

export function importCtx(adapter: ImporterAdapter, limit: number, fetchText: ImportCtx["fetchText"] = fetchPublicText): ImportCtx {
  return { origin: (d) => originFor(adapter.id, d), fetchText, limit };
}
