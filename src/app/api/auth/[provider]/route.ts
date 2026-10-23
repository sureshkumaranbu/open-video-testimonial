import { env } from "@/lib/env";
import { flowCookieHeader, PROVIDERS, type Provider, SignInError, startSignIn } from "@/lib/oidc";
import { clientKey, rateLimit } from "@/lib/rate-limit";

/** "Sign in with Google/Apple": sends the browser to the provider. */
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!PROVIDERS.includes(provider as Provider)) return new Response("Not found", { status: 404 });
  // Each start stores a pending sign-in; don't let one client pile them up.
  if (!rateLimit(`oauth-start:${clientKey(req)}`, 30, 10 * 60 * 1000)) {
    return new Response("Too many sign-in attempts. Please wait a few minutes.", { status: 429 });
  }
  try {
    const { url, flowId } = await startSignIn(provider as Provider);
    return new Response(null, { status: 302, headers: { Location: url, "Set-Cookie": flowCookieHeader(flowId, env.cookieSecure) } });
  } catch (err) {
    const reason = err instanceof SignInError ? err.reason : "failed";
    console.error(`[sign-in] ${provider} couldn't start:`, (err as Error).message);
    return new Response(null, { status: 302, headers: { Location: `${env.publicUrl}/admin/login?error=${reason}` } });
  }
}
