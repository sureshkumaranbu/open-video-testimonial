"use client";

import Link from "next/link";
import { useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    if (res.ok) {
      window.location.href = "/admin";
      return;
    }
    const body = await res.json().catch(() => ({}));
    setError(body.error || "Sign-in failed. Check your email and password.");
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
        <span className="rec-pill">Owner sign-in</span>
      </section>
      <main className="signin-main">
        <form className="signin-form" onSubmit={onSubmit}>
          <div className="stack" style={{ gap: "var(--space-2)" }}>
            <h1 style={{ fontSize: "var(--text-2xl)" }}>Sign in to Plaudit</h1>
            <p className="muted">Use the owner account set in your server&apos;s environment.</p>
          </div>
          <label>
            Email
            <input type="email" name="email" required autoComplete="username" />
          </label>
          <label>
            Password
            <input type="password" name="password" required autoComplete="current-password" />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="lg block" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    </div>
  );
}
