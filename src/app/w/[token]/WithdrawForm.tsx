"use client";

import { useState } from "react";

export function WithdrawForm({ token, projectName }: { token: string; projectName: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  if (state === "done") {
    return (
      <p role="status" className="withdraw-done">
        Done. Your testimonial is no longer shown, and {projectName} can&apos;t publish it again.
      </p>
    );
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setState("busy");
        setError(null);
        const res = await fetch(`/api/withdraw/${token}`, { method: "POST" });
        if (res.ok) {
          setState("done");
        } else {
          setError((await res.json().catch(() => ({}))).error || "That didn't work. Please try again.");
          setState("idle");
        }
      }}
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="danger" disabled={state === "busy"}>
        {state === "busy" ? "Withdrawing…" : "Withdraw my testimonial"}
      </button>
    </form>
  );
}
