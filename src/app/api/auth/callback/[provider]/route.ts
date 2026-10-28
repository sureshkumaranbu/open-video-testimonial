import { readCookie } from "@/lib/auth";
import { env } from "@/lib/env";
import { clearFlowCookieHeader, FLOW_COOKIE, finishSignIn, parkAppleResult, PROVIDERS, type Provider, SignInError } from "@/lib/oidc";
import { completeSignIn } from "@/lib/sign-in";

const toLogin = (error: string, extra = "") =>
  new Response(null, {
    status: 303,
    headers: { Location: `${env.publicUrl}/admin/login?error=${error}${extra}`, "Set-Cookie": clearFlowCookieHeader() },
  });

/** Google and generic OIDC providers redirect back here (and Apple, via the POST below) with a code to swap for an id_token. */
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!PROVIDERS.includes(provider as Provider)) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return toLogin("cancelled");
  try {
    const identity = await finishSignIn(provider as Provider, {
      state: url.searchParams.get("state") ?? "",
      // Apple's code was parked by the POST; the others' arrives here.
      code: provider === "apple" ? null : url.searchParams.get("code"),
      flowId: readCookie(req, FLOW_COOKIE),
    });
    const session = completeSignIn(identity.email, provider as Provider, identity.name);
    if (!session) {
      const who = `&email=${encodeURIComponent(identity.email)}`;
      return toLogin(identity.privateRelay ? "private-relay" : "not-allowed", who);
    }
    const headers = new Headers({ Location: `${env.publicUrl}/admin` });
    headers.append("Set-Cookie", session);
    headers.append("Set-Cookie", clearFlowCookieHeader());
    return new Response(null, { status: 303, headers });
  } catch (err) {
    console.error(`[sign-in] ${provider} failed:`, (err as Error).message);
    return toLogin(err instanceof SignInError ? err.reason : "failed");
  }
}

/**
 * Apple posts the result here from its own site (response_mode=form_post), so
 * the browser doesn't send our SameSite cookies with it. Park the code with
 * its sign-in, then send the browser to the GET above, where it does.
 */
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (provider !== "apple") return new Response("Not found", { status: 404 });
  const form = await req.formData().catch(() => null);
  const state = String(form?.get("state") ?? "");
  if (form?.get("error")) return toLogin("cancelled");
  const code = String(form?.get("code") ?? "");
  const user = form?.get("user");
  if (!state || !code || !parkAppleResult(state, code, typeof user === "string" ? user : null)) return toLogin("expired");
  return new Response(null, {
    status: 303,
    headers: { Location: `${env.publicUrl}/api/auth/callback/apple?state=${encodeURIComponent(state)}` },
  });
}
