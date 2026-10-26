import fs from "node:fs";
import path from "node:path";
import type { ImportCtx } from "@/lib/importers/types";
import type { PublicText, PublicTextOptions } from "@/lib/net-guard";

export const fixture = (p: string) => fs.readFileSync(path.resolve(__dirname, "../fixtures/importers", p), "utf8");

export type Answer = { status?: number; text?: string; file?: string; contentType?: string };
export type Call = { url: string; o: PublicTextOptions };

/**
 * An ImportCtx whose fetch answers from `routes` (the first key the URL
 * contains wins) and records every call. No network, no ports.
 */
export function fakeCtx(routes: Record<string, Answer | ((url: string, o: PublicTextOptions) => Answer)>, limit = 50) {
  const calls: Call[] = [];
  const ctx: ImportCtx = {
    limit,
    origin: (d) => d,
    fetchText: async (url: string, o: PublicTextOptions = {}): Promise<PublicText> => {
      calls.push({ url, o });
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) return { status: 404, text: "not found", finalUrl: url, contentType: "text/plain" };
      const route = routes[key];
      const a = typeof route === "function" ? route(url, o) : route;
      return { status: a.status ?? 200, text: a.text ?? (a.file ? fixture(a.file) : ""), finalUrl: url, contentType: a.contentType ?? "text/html" };
    },
  };
  return { ctx, calls };
}
