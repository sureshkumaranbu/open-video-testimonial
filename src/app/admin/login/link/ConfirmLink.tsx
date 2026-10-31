"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ConfirmLink({ token, label }: { token: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        type="button"
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch("/api/auth/email/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
          if (res.ok) {
            window.location.href = "/admin";
            return;
          }
          setError((await res.json().catch(() => ({}))).error || "Sign-in failed. Ask for a new link.");
          setBusy(false);
        }}
      >
        {busy ? "Signing in…" : label}
      </Button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
