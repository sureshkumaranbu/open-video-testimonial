import type { NextConfig } from "next";
import { publicCsp } from "./src/lib/csp";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  async headers() {
    // Later entries win when they set the same header on the same path.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // Everything but the dashboard (whose nonce-based policy comes from
        // src/proxy.ts) and the embeddable widget page must never be framed.
        source: "/:path((?!admin(?:/|$)|embed/).*)",
        headers: [
          { key: "Content-Security-Policy", value: publicCsp() },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // The iframe embed is meant to be shown on the owner's own sites.
        source: "/embed/:path*",
        headers: [{ key: "Content-Security-Policy", value: publicCsp({ frameable: true }) }],
      },
      {
        // The admin area must never be framed by other sites.
        source: "/admin/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
      {
        // Private withdrawal, unsubscribe, "No thanks" and campaign links must not leak through the Referer header.
        source: "/:prefix(w|u|d|r)/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        // Widgets put @font-face rules in the host page's <head> (a shadow root
        // ignores them), so customers' sites load these fonts cross-origin.
        source: "/fonts/:path*",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default nextConfig;
