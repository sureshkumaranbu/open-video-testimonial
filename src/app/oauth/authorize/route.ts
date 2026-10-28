import { readCookie, sessionCookieName, sessionFromToken } from "@/lib/auth";
import { env } from "@/lib/env";
import { featureOn } from "@/lib/features";
import { RESUME_COOKIE, parseAuthorize, signRequest } from "@/lib/oauth";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A problem we can't send back to the app (unknown client, unregistered redirect): our own page, never a redirect. */
function page(message: string) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Can't connect</title>` +
      `<main style="font:16px system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1 style="font-size:1.4rem">This app can't connect to Plaudit</h1><p>${esc(message)}</p></main>`,
    { status: 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

/**
 * The authorization endpoint. A valid request goes to the consent page in
 * the dashboard; someone not signed in signs in first and comes back there
 * (the request rides in a short-lived cookie scoped to /admin). The
 * destination is always our own consent page, so nothing here can redirect
 * anywhere else.
 */
export function GET(req: Request) {
  if (!featureOn("mcp")) return new Response("Not found", { status: 404 });
  const r = parseAuthorize(new URL(req.url).searchParams);
  if ("page" in r) return page(r.page);
  if ("redirect" in r) return new Response(null, { status: 302, headers: { Location: r.redirect, "Cache-Control": "no-store" } });
  const signed = signRequest(r.ok);
  const consent = `${env.publicUrl}/admin/oauth?req=${encodeURIComponent(signed)}`;
  if (sessionFromToken(readCookie(req, sessionCookieName()))) return new Response(null, { status: 302, headers: { Location: consent, "Cache-Control": "no-store" } });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${env.publicUrl}/admin/login`,
      "Cache-Control": "no-store",
      "Set-Cookie": `${RESUME_COOKIE}=${encodeURIComponent(signed)}; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=600${env.cookieSecure ? "; Secure" : ""}`,
    },
  });
}
