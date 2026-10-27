"use client";

import { useState } from "react";

export function DeclineButton({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) return <p role="status">Thanks for letting them know. You won&apos;t get reminders about this.</p>;
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await fetch(`/api/decline/${token}`, { method: "POST" }).catch(() => null);
          setBusy(false);
          if (res?.ok) setDone(true);
          else setError("That didn't work. Please try again.");
        }}
      >
        {busy ? "Saving…" : "No thanks"}
      </button>
    </>
  );
}
