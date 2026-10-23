"use client";

import { useState } from "react";

type Result =
  | { ok: true; to: string; mode: "smtp" | "outbox" }
  | { ok: false; error: string; hint: string | null; fromServer: boolean };

/** "Send test email": checks the mail settings without waiting for a real invitation to fail. */
export function EmailTest({ defaultTo }: { defaultTo: string }) {
  const [to, setTo] = useState(defaultTo);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const body = await res.json().catch(() => ({}));
      setResult(
        res.ok
          ? { ok: true, to: body.to, mode: body.mode }
          : { ok: false, error: body.error || `Request failed (${res.status})`, hint: body.hint ?? null, fromServer: res.status === 502 },
      );
    } catch {
      setResult({ ok: false, error: "Couldn't reach Plaudit. Check your connection.", hint: null, fromServer: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={send} data-testid="email-test">
      <div className="row" style={{ alignItems: "end" }}>
        <label style={{ flex: "1 1 16rem" }}>
          Send a test email to
          <input type="email" value={to} onChange={(e) => setTo(e.target.value)} required maxLength={254} autoComplete="email" />
        </label>
        <button type="submit" className="secondary" disabled={busy}>
          {busy ? "Sending…" : "Send test email"}
        </button>
      </div>
      {result?.ok && (
        <p className="notice" role="status" data-testid="email-test-result">
          {result.mode === "outbox"
            ? `Written to DATA_DIR/mail-outbox for ${result.to} (test mode, nothing was sent).`
            : `Sent to ${result.to}. If it isn't in the inbox in a minute or two, check the spam folder.`}
        </p>
      )}
      {result && !result.ok && (
        <div className="notice warn stack" role="alert" data-testid="email-test-result">
          {result.fromServer ? (
            <p>
              <strong>It didn&apos;t send.</strong> The mail server said: <code style={{ overflowWrap: "anywhere" }}>{result.error}</code>
            </p>
          ) : (
            <p>{result.error}</p>
          )}
          {result.hint && <p>{result.hint}</p>}
        </div>
      )}
    </form>
  );
}
