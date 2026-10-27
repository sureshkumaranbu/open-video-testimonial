"use client";

import Link from "next/link";
import { useState } from "react";

type Methods = { password: boolean; email: boolean; google: boolean; apple: boolean; oidc: boolean; oidcLabel: string };

export function LoginForm({ methods, error: initialError }: { methods: Methods; error: string | null }) {
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const providers = methods.google || methods.apple || methods.oidc;
  const none = !methods.password && !methods.email && !providers;

  async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, body: await res.json().catch(() => ({})) };
  }

  async function onPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const form = new FormData(e.currentTarget);
    const res = await post("/api/admin/login", { email: form.get("email"), password: form.get("password") });
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
    const res = await post("/api/auth/email", { email: new FormData(e.currentTarget).get("email") });
    if (res.ok) setNotice(res.body.message);
    else setError(res.body.error || "Couldn't send a link. Please try again.");
    setBusy(false);
  }

  return (
    <div className="signin">
      <section className="signin-art" aria-hidden>
        <Link href="/" className="brand" tabIndex={-1}>
          <span className="brand-dot" />
          Plaudit
        </Link>
        <blockquote>The best line on your homepage is one you didn&apos;t write.</blockquote>
        <span className="rec-pill">Team sign-in</span>
      </section>
      <main className="signin-main">
        <div className="signin-form">
          <div className="stack" style={{ gap: "var(--space-2)" }}>
            <h1 style={{ fontSize: "var(--text-2xl)" }}>Sign in to Plaudit</h1>
            {none && <p className="muted">No sign-in method is set up. Set ADMIN_EMAIL and ADMIN_PASSWORD on the server (see docs/AUTH.md).</p>}
          </div>

          {providers && (
            <div className="stack" style={{ gap: "var(--space-3)" }} data-testid="sign-in-providers">
              {methods.google && (
                <a className="button secondary lg block" href="/api/auth/google">
                  Continue with Google
                </a>
              )}
              {methods.apple && (
                <a className="button secondary lg block" href="/api/auth/apple">
                  Continue with Apple
                </a>
              )}
              {methods.oidc && (
                <a className="button secondary lg block" href="/api/auth/oidc">
                  Continue with {methods.oidcLabel}
                </a>
              )}
            </div>
          )}

          {methods.email && (
            <form className="stack" style={{ gap: "var(--space-3)" }} onSubmit={onEmailLink} data-testid="email-link-form">
              {providers && <p className="divider muted small">or get a link by email</p>}
              <label>
                {methods.password ? "Email me a sign-in link" : "Email"}
                <input type="email" name="email" required autoComplete="email" maxLength={254} />
              </label>
              <button type="submit" className={methods.password ? "secondary block" : "lg block"} disabled={busy}>
                Email me a link
              </button>
            </form>
          )}

          {methods.password && (
            <form className="stack" style={{ gap: "var(--space-4)" }} onSubmit={onPassword} data-testid="password-form">
              {(providers || methods.email) && <p className="divider muted small">or use the owner password</p>}
              <label>
                Email
                <input type="email" name="email" required autoComplete="username" />
              </label>
              <label>
                Password
                <input type="password" name="password" required autoComplete="current-password" />
              </label>
              <button type="submit" className="lg block" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          )}

          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
