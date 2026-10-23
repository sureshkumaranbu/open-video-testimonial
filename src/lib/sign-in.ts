import { createSessionToken, sessionCookieHeader, type SignInMethod } from "./auth";
import { emailEnabled } from "./email";
import { env } from "./env";
import { recordSignIn, roleFor } from "./members";
import { providerStatus } from "./oidc";

/** Which ways of signing in this server offers. */
export function signInMethods() {
  const email = emailEnabled();
  const google = providerStatus("google");
  const apple = providerStatus("apple");
  const others = email || google.enabled || apple.enabled;
  const hasPassword = Boolean(env.adminEmail && env.adminPassword);
  // PASSWORD_LOGIN=false only takes effect once another way in works, so a
  // typo can't lock everyone out.
  const password = hasPassword && (env.passwordLogin || !others);
  return {
    password,
    passwordKeptOn: hasPassword && !env.passwordLogin && !others,
    email,
    google: google.enabled,
    apple: apple.enabled,
    status: { google, apple },
  };
}

export type SignInMethods = ReturnType<typeof signInMethods>;

/**
 * Signs a verified address in, if it's allowed: a fresh session cookie, and
 * the sign-in noted against the team member. Returns null if not allowed.
 */
export function completeSignIn(email: string, method: SignInMethod, name?: string | null) {
  if (!roleFor(email)) return null;
  recordSignIn(email, name);
  return sessionCookieHeader(createSessionToken(email, method));
}
