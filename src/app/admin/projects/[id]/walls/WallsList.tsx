"use client";

import "@/app/admin/walls.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { ConfirmDialog, EmptyState } from "@/components/admin";
import { Icon } from "@/components/Icon";
import { THEME_LABELS } from "@/lib/wall-config";
import type { AdminWall } from "@/lib/walls";

type Props = { projectId: string; projectSlug: string; initial: AdminWall[] };

/** WALL-01: walls list, a new wall, which one is main, and deleting. */
export function WallsList({ projectId, projectSlug, initial }: Props) {
  const router = useRouter();
  const [walls, setWalls] = useState(initial);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminWall | null>(null);
  const main = walls.find((w) => w.isMain);

  async function reload() {
    setWalls((await api<{ walls: AdminWall[] }>(`/api/admin/projects/${projectId}/walls`)).walls);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { wall } = await api<{ wall: AdminWall }>(`/api/admin/projects/${projectId}/walls`, { method: "POST", json: { name } });
      router.push(`/admin/projects/${projectId}/walls/${wall.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      <form className="panel" onSubmit={create} data-testid="new-wall">
        <div className="panel-body wl-new">
          <label>
            New wall name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="Customer love" />
          </label>
          <button type="submit" className="accent" disabled={busy || !name.trim()}>
            <Icon name="plus" />
            {busy ? "Creating…" : "Create wall"}
          </button>
        </div>
      </form>
      <p className="muted small" data-testid="main-wall-note">
        {main?.published ? (
          <>
            <code>/wall/{projectSlug}</code> shows “{main.name}”.
          </>
        ) : main ? (
          <>
            “{main.name}” is the main wall but still a draft, so <code>/wall/{projectSlug}</code> shows the classic page until you publish it.
          </>
        ) : (
          <>
            <code>/wall/{projectSlug}</code> shows the classic wall. Mark a published wall as main to show it there instead.
          </>
        )}
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {walls.length === 0 ? (
        <EmptyState icon="star" title="No walls yet" testId="walls-empty">
          <p>Create one above. Your current wall page stays as it is.</p>
        </EmptyState>
      ) : (
        <div className="panel">
          <table className="wl-table" data-testid="walls-table">
            <thead>
              <tr>
                <th scope="col">Wall</th>
                <th scope="col">Status</th>
                <th scope="col">Theme</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {walls.map((w) => (
                <tr key={w.id} data-testid="wall-row" data-wall-id={w.id}>
                  <td>
                    <Link className="wl-name" href={`/admin/projects/${projectId}/walls/${w.id}`}>
                      {w.name}
                    </Link>
                    <div className="muted xsmall">
                      <code>{w.url}</code>
                    </div>
                  </td>
                  <td>
                    <span className="wl-badge" data-state={w.published ? "published" : "draft"}>
                      {w.published ? "Published" : "Draft"}
                    </span>
                    {w.isMain && (
                      <span className="wl-badge" data-state="main">
                        Main
                      </span>
                    )}
                  </td>
                  <td className="muted">{THEME_LABELS[w.theme].name}</td>
                  <td>
                    <div className="wl-actions">
                      <Link className="button secondary small" href={`/admin/projects/${projectId}/walls/${w.id}`}>
                        <Icon name="pen" />
                        Edit
                      </Link>
                      {w.published && (
                        <a className="button secondary small" href={w.publicUrl} target="_blank" rel="noreferrer">
                          <Icon name="external" />
                          View
                        </a>
                      )}
                      <button type="button" className="secondary small danger" onClick={() => setDeleting(w)}>
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
        confirmLabel="Delete wall"
        busyLabel="Deleting…"
        danger
        onConfirm={async () => {
          setError(null);
          try {
            await api(`/api/admin/walls/${deleting!.id}`, { method: "DELETE" });
            await reload();
          } catch (err) {
            setError(errorMessage(err));
          }
          setDeleting(null);
        }}
      >
        <p>
          Its page and old links stop working.
          {deleting?.isMain ? " Your project’s wall address goes back to the classic page." : ""} Testimonials stay as they are.
        </p>
      </ConfirmDialog>
    </div>
  );
}
