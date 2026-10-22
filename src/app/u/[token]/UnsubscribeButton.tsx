"use client";

import { useState } from "react";

export function UnsubscribeButton({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) return <p role="status">You won&apos;t get any more emails about this request.</p>;
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={async () => {
          const res = await fetch(`/api/unsubscribe/${token}`, { method: "POST" });
          if (res.ok) setDone(true);
          else setError("That didn't work. Please try again.");
        }}
      >
        Stop these emails
      </button>
    </>
  );
}
