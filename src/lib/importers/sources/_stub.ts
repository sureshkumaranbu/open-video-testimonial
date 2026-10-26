import { z } from "zod";
import type { AdapterId, ImporterAdapter, ImportMethod } from "../types";

/** A placeholder for a source whose adapter isn't written yet: listed, but unavailable. */
export function stubAdapter(id: AdapterId, label: string, kind: "platform" | "migration", method: ImportMethod): ImporterAdapter {
  return {
    id,
    label,
    platform: id,
    kind,
    method,
    tosNotes: "",
    fields: [],
    input: z.unknown(),
    unavailable: () => "Not available yet",
    async fetchPage() {
      return { items: [], next: null };
    },
  };
}
