"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";

export function LogoutButton() {
  return (
    <button
      type="button"
      className="ghost small"
      aria-label="Sign out"
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        window.location.href = "/admin/login";
      }}
    >
      <Icon name="logout" />
      <span className="hide-narrow">Sign out</span>
    </button>
  );
}

/** B-05: ends every session this person has, this one included (the same as Sign out). */
export function SignOutEverywhereButton() {
  return (
    <button
      type="button"
      className="secondary small"
      data-testid="sign-out-everywhere"
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        window.location.href = "/admin/login";
      }}
    >
      Sign out everywhere
    </button>
  );
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch("/api/admin/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, slug }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || "The project wasn't created. Try a different link slug.");
      setBusy(false);
      return;
    }
    router.push(`/admin/projects/${body.project.id}`);
  }

  return (
    <form className="card stack" onSubmit={onSubmit} style={{ borderStyle: "dashed", boxShadow: "none" }}>
      <div className="stack" style={{ gap: "var(--space-1)" }}>
        <h2>New project</h2>
        <p className="muted small">One project per product or brand. Each gets its own collection link.</p>
      </div>
      <label>
        Name
        <input
          type="text"
          value={name}
          required
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
          placeholder="Acme Analytics"
        />
      </label>
      <label>
        <span>
          Link slug <span className="hint">(lowercase letters, numbers and dashes)</span>
        </span>
        <input
          type="text"
          value={slug}
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          placeholder="acme"
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create project"}
        </button>
      </div>
    </form>
  );
}

type ImportState =
  | { step: "idle" }
  | { step: "uploading"; percent: number }
  | { step: "importing"; projectId: string; name: string }
  | { step: "done"; projectId: string; name: string; count: number }
  | { step: "error"; message: string };

/** Uploads a Plaudit export (.zip) and recreates it as a new project. */
export function ImportProjectForm() {
  const [state, setState] = useState<ImportState>({ step: "idle" });

  async function run(file: File) {
    const { ResumableUpload } = await import("@/lib/resumable-upload");
    setState({ step: "uploading", percent: 0 });
    try {
      const upload = new ResumableUpload({
        createUrl: "/api/admin/uploads",
        size: file.size,
        onProgress: (s) => setState({ step: "uploading", percent: s.total ? Math.floor((s.sent / s.total) * 100) : 0 }),
      });
      upload.append(file);
      const { id, token } = await upload.finish();
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: id, token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "The import didn't start");
      setState({ step: "importing", projectId: body.project.id, name: body.project.name });
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const job = await (await fetch(`/api/admin/jobs/${body.jobId}`)).json();
        if (job.status === "done") {
          setState({ step: "done", projectId: body.project.id, name: body.project.name, count: body.counts.testimonials });
          return;
        }
        if (job.status === "failed") throw new Error(job.error || "The import failed");
      }
    } catch (err) {
      setState({ step: "error", message: (err as Error).message });
    }
  }

  return (
    <div className="card stack" style={{ borderStyle: "dashed", boxShadow: "none" }} data-testid="import-project">
      <div className="stack" style={{ gap: "var(--space-1)" }}>
        <h2>Import a project</h2>
        <p className="muted small">Restore a backup, or move a project from another Plaudit server, using its export .zip.</p>
      </div>
      {state.step === "uploading" && <p className="small">Uploading… {state.percent}%</p>}
      {state.step === "importing" && <p className="small">Importing into “{state.name}”…</p>}
      {state.step === "done" && (
        <p className="small" role="status">
          Imported {state.count} testimonial{state.count === 1 ? "" : "s"} into{" "}
          <a href={`/admin/projects/${state.projectId}`}>{state.name}</a>.
        </p>
      )}
      {state.step === "error" && (
        <p className="error" role="alert">
          {state.message}
        </p>
      )}
      <label className="button secondary" style={{ flexDirection: "row", alignSelf: "flex-start" }}>
        <Icon name="upload" />
        Choose export .zip
        <input
          type="file"
          accept=".zip,application/zip"
          data-testid="import-file"
          style={{ display: "none" }}
          disabled={state.step === "uploading" || state.step === "importing"}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void run(file);
          }}
        />
      </label>
    </div>
  );
}
