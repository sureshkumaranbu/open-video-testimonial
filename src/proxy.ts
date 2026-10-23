import { type NextRequest, NextResponse } from "next/server";
import { adminCsp } from "@/lib/csp";

/**
 * Gives every dashboard page a fresh nonce and a strict Content Security
 * Policy built on it. Next.js reads the nonce from the request's policy and
 * adds it to the scripts it renders (the admin layout is dynamic, so every
 * admin page is rendered per request). Public pages get a static policy
 * from next.config.ts instead.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = adminCsp(nonce);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
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
