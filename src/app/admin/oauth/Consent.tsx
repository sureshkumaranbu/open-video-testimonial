"use client";

import { useState } from "react";
import { api, errorMessage } from "@/app/admin/api";

type Props = {
  req: string;
  clientName: string;
  redirectHost: string;
  wantsWrite: boolean;
  canWrite: boolean;
  email: string;
  projects: { id: string; name: string }[];
};

/**
 * The consent form. It answers with fetch and then goes to the app's address
 * itself, because the dashboard's CSP keeps form posts on this site.
 */
export function Consent({ req, clientName, redirectHost, wantsWrite, canWrite, email, projects }: Props) {
  const [scope, setScope] = useState<"read" | "write">("read");
  const [all, setAll] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(decision: "allow" | "deny") {
    setBusy(true);
    setError(null);
    try {
      const { redirect } = await api<{ redirect: string }>("/api/admin/oauth/authorize", {
        method: "POST",
        json: { req, decision, scope, projectIds: all ? null : chosen },
      });
      window.location.assign(redirect);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <section className="panel" data-testid="oauth-consent">
      <div className="panel-body stack">
        <h1 style={{ fontSize: "var(--text-xl)" }}>Let “{clientName}” use Plaudit?</h1>
        <p>
          It will act as you ({email}) through Plaudit&apos;s MCP server, with your role and projects. After you allow it, it goes back to{" "}
          <strong>{redirectHost}</strong>.
        </p>
        <fieldset className="stack" style={{ border: 0, padding: 0, gap: "var(--space-2)" }}>
          <legend className="small">What it may do</legend>
          <label className="row" style={{ gap: "var(--space-2)" }}>
            <input type="radio" name="scope" checked={scope === "read"} onChange={() => setScope("read")} />
            Read: look up and search testimonials, embed codes and a summary
          </label>
          {wantsWrite && (
            <label className="row" style={{ gap: "var(--space-2)", opacity: canWrite ? 1 : 0.6 }}>
              <input type="radio" name="scope" checked={scope === "write"} disabled={!canWrite} onChange={() => setScope("write")} />
              Read and send invitations through your campaigns{!canWrite && " (your role can only view)"}
            </label>
          )}
        </fieldset>
        <fieldset className="stack" style={{ border: 0, padding: 0, gap: "var(--space-1)" }}>
          <legend className="small">Projects</legend>
          <label className="row small" style={{ gap: "var(--space-2)" }}>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Every project I can open
          </label>
          {!all &&
            projects.map((p) => (
              <label key={p.id} className="row small" style={{ gap: "var(--space-2)" }}>
                <input
                  type="checkbox"
                  checked={chosen.includes(p.id)}
                  onChange={(e) => setChosen(e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))}
                />
                {p.name}
              </label>
            ))}
        </fieldset>
        <p className="muted small">It never sees anyone&apos;s email address or phone number. An admin can disconnect it under Settings › API keys.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="button" onClick={() => answer("allow")} disabled={busy || (!all && chosen.length === 0)}>
            Allow
          </button>
          <button type="button" className="secondary" onClick={() => answer("deny")} disabled={busy}>
            Deny
          </button>
        </div>
      </div>
    </section>
  );
}
