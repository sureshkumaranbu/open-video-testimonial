"use client";

import "@/app/admin/boosters.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { ConfirmDialog, EmptyState } from "@/components/admin";
import { Icon } from "@/components/Icon";
import type { AdminBooster } from "@/lib/boosters";

/** BOOST-01: the booster pages, a new one, and deleting. */
export function BoostersList({ projectId, initial }: { projectId: string; initial: AdminBooster[] }) {
  const router = useRouter();
  const [boosters, setBoosters] = useState(initial);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminBooster | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { booster } = await api<{ booster: AdminBooster }>(`/api/admin/projects/${projectId}/boosters`, { method: "POST", json: { name } });
      router.push(`/admin/projects/${projectId}/boosters/${booster.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      <form className="panel" onSubmit={create} data-testid="new-booster">
        <div className="panel-body bs-new">
          <label>
            New page name
            <input id="new-booster-name" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="Reviews" />
          </label>
          <button type="submit" className="accent" disabled={busy || !name.trim()}>
            <Icon name="plus" />
            {busy ? "Creating…" : "Create page"}
          </button>
        </div>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {boosters.length === 0 ? (
        <EmptyState
          icon="star"
          title="No booster pages yet"
          testId="boosters-empty"
          action={
            <button type="button" onClick={() => document.getElementById("new-booster-name")?.focus()}>
              Create a page
            </button>
          }
        >
          <p>Make one page with a button for each review site, then share its link or print its QR code at the till, on receipts or on packaging.</p>
        </EmptyState>
      ) : (
        <div className="panel">
          <table className="bs-table" data-testid="boosters-table">
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">Status</th>
                <th scope="col">Links</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {boosters.map((b) => (
                <tr key={b.id} data-testid="booster-row">
                  <td>
                    <Link className="bs-name" href={`/admin/projects/${projectId}/boosters/${b.id}`}>
                      {b.name}
                    </Link>
                    <div className="muted xsmall">
                      <code>{b.url}</code>
                    </div>
                  </td>
                  <td>
                    <span className="bs-badge" data-state={b.published ? "public" : "draft"}>
                      {b.published ? "Public" : "Draft"}
                    </span>
                  </td>
                  <td className="muted">{b.links.length}</td>
                  <td>
                    <div className="bs-actions">
                      <Link className="button secondary small" href={`/admin/projects/${projectId}/boosters/${b.id}`}>
                        <Icon name="pen" />
                        Edit
                      </Link>
                      {b.published && (
                        <a className="button secondary small" href={b.url} target="_blank" rel="noreferrer">
                          <Icon name="external" />
                          View
                        </a>
                      )}
                      <button type="button" className="secondary small danger" onClick={() => setDeleting(b)}>
                        <Icon name="trash" />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name ?? ""}”?`}
        confirmLabel="Delete page"
        busyLabel="Deleting…"
        danger
        onConfirm={async () => {
          setError(null);
          try {
            await api(`/api/admin/boosters/${deleting!.id}`, { method: "DELETE" });
            setBoosters((list) => list.filter((b) => b.id !== deleting!.id));
          } catch (err) {
            setError(errorMessage(err));
          }
          setDeleting(null);
        }}
      >
        <p>Its link and any QR codes you printed stop working, and its click counts go with it.</p>
      </ConfirmDialog>
    </div>
  );
}
