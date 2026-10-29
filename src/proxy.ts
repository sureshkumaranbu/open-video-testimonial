import { type NextRequest, NextResponse } from "next/server";
import { adminCsp, publicCsp } from "@/lib/csp";
import { directUploadOrigin } from "@/lib/direct-upload";
import { wallCspExtra } from "@/lib/wall-head";

/** Public pages that upload videos: the classic page, step-by-step forms and their embeds. */
const UPLOAD_PAGE = /^\/(c\/[^/]+|f\/[^/]+\/[^/]+|embed\/[^/]+\/form\/[^/]+)\/?$/;

/**
 * Gives every dashboard page a fresh nonce and a strict Content Security
 * Policy built on it. Next.js reads the nonce from the request's policy and
 * adds it to the scripts it renders (the admin layout is dynamic, so every
 * admin page is rendered per request). Public pages get a static policy
 * from next.config.ts instead, except walls, whose policy is set here so a
 * wall with an analytics provider allows exactly that provider (WALL-07),
 * and upload pages while direct uploads are on, which may also connect to
 * the owner's bucket (L9). With direct uploads off those keep the static one.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/v1/")) return extensionCors(request);
  // Walls: the public policy, plus the hosts of the analytics provider this wall's owner chose (WALL-07).
  if (pathname.startsWith("/wall/")) {
    const response = NextResponse.next();
    response.headers.set("Content-Security-Policy", publicCsp({ extra: wallCspExtra(pathname) }));
    return response;
  }
  const bucket = directUploadOrigin();
  if (!pathname.startsWith("/admin")) {
    const response = NextResponse.next();
    if (bucket && UPLOAD_PAGE.test(pathname)) {
      response.headers.set("Content-Security-Policy", publicCsp({ frameable: pathname.startsWith("/embed/"), extra: { script: [], connect: [bucket], img: [] } }));
    }
    return response;
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = adminCsp(nonce, bucket ? [bucket] : []);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

/** EXT-01: the browser extension's pages, in Chrome and Firefox (each install's own id). */
const EXTENSION_ORIGIN = /^(?:chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[0-9a-f-]{36})$/;
const CORS_METHODS = "GET, POST, PATCH, PUT, DELETE";

/**
 * EXT-01: /api/v1 answers cross-origin only to the browser extension, and
 * only for requests with an API key. Never with credentials, so cookies
 * can't be used from there; every other origin gets no CORS headers, as
 * before. The preflight is answered here, because the routes have none.
 */
function extensionCors(request: NextRequest) {
  const origin = request.headers.get("origin") ?? "";
  if (!EXTENSION_ORIGIN.test(origin) || request.nextUrl.pathname === "/api/v1/openapi.json") return NextResponse.next();
  if (request.method === "OPTIONS") {
    const asks = (request.headers.get("access-control-request-headers") ?? "").toLowerCase().split(",").map((h) => h.trim());
    // A preflight that won't send the key gets nothing to work with.
    if (!asks.includes("authorization")) return new NextResponse(null, { status: 204, headers: { Vary: "Origin" } });
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": CORS_METHODS,
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      },
    });
  }
  const response = NextResponse.next();
  if (/^Bearer\s+plk_/.test(request.headers.get("authorization") ?? "")) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
  }
  return response;
}

export const config = {
  matcher: [
    "/api/v1/:path*",
    "/wall/:path*",
    "/c/:path*",
    "/f/:path*",
    "/embed/:slug/form/:path*",
    {
      source: "/admin/:path*",
      // Link prefetches fetch data, not documents, and need no policy.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
