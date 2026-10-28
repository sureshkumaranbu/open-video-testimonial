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

export const config = {
  matcher: [
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
