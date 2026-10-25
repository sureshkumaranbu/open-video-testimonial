"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/app/admin/api";
import { ConfirmDialog } from "@/components/admin";
import { Icon } from "@/components/Icon";
import "@/app/admin/project-settings.css";

/**
 * Deleting the project, for the owner only, behind the project's name typed
 * out. Everything goes for good, so the panel points to the export first.
 */
export function DangerZone({ projectId, name, isOwner }: { projectId: string; name: string; isOwner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function confirm() {
    await api(`/api/admin/projects/${projectId}`, { method: "DELETE", json: { confirm: name } });
    router.replace("/admin");
    router.refresh();
  }

  return (
    <section className="panel ps-danger" aria-labelledby="ps-danger-h" data-testid="danger-zone">
      <div className="panel-head">
        <h2 id="ps-danger-h" className="ps-title">
          <Icon name="trash" />
          Delete project
        </h2>
      </div>
      <div className="panel-body stack">
        <p>
          Deleting <strong>{name}</strong> removes its testimonials, videos and photos, forms, requests, consent records, tags and webhooks for
          good. Its links, old and new, stop working.
        </p>
        <p className="muted small">
          Want a copy first? <Link href={`/admin/projects/${projectId}/data`}>Export everything</Link> as a zip you can import again later.
        </p>
        {isOwner ? (
          <div className="row">
            <button type="button" className="ak-danger" onClick={() => setOpen(true)}>
              <Icon name="trash" />
              Delete project…
            </button>
          </div>
        ) : (
          <p className="notice" data-testid="owner-only">
            Only the owner can delete a project.
          </p>
        )}
      </div>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={confirm}
        title={`Delete ${name}?`}
        confirmLabel="Delete project"
        busyLabel="Deleting…"
        danger
        requireText={name}
        testId="delete-project-dialog"
      >
        <p>This can&apos;t be undone. Every testimonial, file and setting of this project is deleted.</p>
      </ConfirmDialog>
    </section>
  );
}
