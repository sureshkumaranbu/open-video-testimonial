"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Divider, SignInFrame } from "./SignInFrame";

type Methods = {
  password: boolean;
  email: boolean;
  google: boolean;
  apple: boolean;
  oidc: boolean;
  oidcLabel: string;
};

export function LoginForm({ methods, error: initialError }: { methods: Methods; error: string | null }) {
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const providers = methods.google || methods.apple || methods.oidc;
  const none = !methods.password && !methods.email && !providers;

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, body: await res.json().catch(() => ({})) };
  }

  async function onPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const form = new FormData(e.currentTarget);
    const res = await post("/api/admin/login", {
      email: form.get("email"),
      password: form.get("password"),
    });
    if (res.ok) {
      window.location.href = "/admin";
      return;
    }
    setError(res.body.error || "Sign-in failed. Check your email and password.");
    setBusy(false);
  }

  async function onEmailLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await post("/api/auth/email", {
      email: new FormData(e.currentTarget).get("email"),
    });
    if (res.ok) setNotice(res.body.message);
    else setError(res.body.error || "Couldn't send a link. Please try again.");
    setBusy(false);
  }

  return (
    <SignInFrame>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[1.875rem] leading-tight font-bold tracking-tight text-foreground">Sign in to Plaudit</h1>
        {none ? (
          <p className="text-muted-foreground">No sign-in method is set up. Set ADMIN_EMAIL and ADMIN_PASSWORD on the server (see docs/AUTH.md).</p>
        ) : (
          <p className="text-muted-foreground">Choose how you&apos;d like to sign in.</p>
        )}
      </div>

      {providers && (
        <div className="flex flex-col gap-2.5" data-testid="sign-in-providers">
          {methods.google && (
            <Button asChild variant="outline" className="w-full">
              <a href="/api/auth/google">Continue with Google</a>
            </Button>
          )}
          {methods.apple && (
            <Button asChild variant="outline" className="w-full">
              <a href="/api/auth/apple">Continue with Apple</a>
            </Button>
          )}
          {methods.oidc && (
            <Button asChild variant="outline" className="w-full">
              <a href="/api/auth/oidc">Continue with {methods.oidcLabel}</a>
            </Button>
          )}
        </div>
      )}

      {methods.email && (
        <form className="flex flex-col gap-3" onSubmit={onEmailLink} data-testid="email-link-form">
          {providers && <Divider>or get a link by email</Divider>}
          <label>
            {methods.password ? "Email me a sign-in link" : "Email"}
            <input type="email" name="email" required autoComplete="email" maxLength={254} />
          </label>
          <Button type="submit" variant={methods.password ? "outline" : "default"} className="w-full" disabled={busy}>
            Email me a link
          </Button>
        </form>
      )}

      {methods.password && (
        <form className="flex flex-col gap-4" onSubmit={onPassword} data-testid="password-form">
          {(providers || methods.email) && <Divider>or use the owner password</Divider>}
          <label>
            Email
            <input type="email" name="email" required autoComplete="username" />
          </label>
          <label>
            Password
            <input type="password" name="password" required autoComplete="current-password" />
          </label>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      )}

      {notice && (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </SignInFrame>
  );
}
