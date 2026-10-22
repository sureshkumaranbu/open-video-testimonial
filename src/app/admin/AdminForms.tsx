"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";

export function LogoutButton() {
  return (
    <button
      type="button"
      className="ghost small"
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        window.location.href = "/admin/login";
      }}
    >
      <Icon name="logout" />
      Sign out
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
