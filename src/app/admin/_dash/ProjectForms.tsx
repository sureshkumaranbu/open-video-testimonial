"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { FolderPlusIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** The dashboard home's card look, shared by its two forms. */
const card = "flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-1)] sm:p-6";

function CardHead({ icon: Icon, title, text, id }: { icon: typeof FolderPlusIcon; title: string; text: string; id: string }) {
  return (
    <div className="flex items-start gap-3.5">
      <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <h2 id={id} className="text-lg leading-snug font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

/** Name and link slug; the slug follows the name until it's edited by hand. */
export function NewProjectForm({ className, first = false }: { className?: string; first?: boolean }) {
  const router = useRouter();
  const id = useId();
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
    <form className={cn(card, className)} onSubmit={onSubmit} aria-labelledby={`${id}-h`} data-testid="new-project">
      <CardHead
        id={`${id}-h`}
        icon={FolderPlusIcon}
        title={first ? "Create your first project" : "New project"}
        text="One project per product or brand. Each gets its own collection link."
      />
      <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
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
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Creating…" : "Create project"}
        </Button>
        {slug && (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" aria-live="polite">
            Collection link: /c/{slug}
          </span>
        )}
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
export function ImportProjectForm({ className }: { className?: string }) {
  const id = useId();
  const [state, setState] = useState<ImportState>({ step: "idle" });
  const busy = state.step === "uploading" || state.step === "importing";

  async function run(file: File) {
    const { ResumableUpload } = await import("@/lib/resumable-upload");
    setState({ step: "uploading", percent: 0 });
    try {
      const upload = new ResumableUpload({
        createUrl: "/api/admin/uploads",
        size: file.size,
        onProgress: (s) =>
          setState({
            step: "uploading",
            percent: s.total ? Math.floor((s.sent / s.total) * 100) : 0,
          }),
      });
      upload.append(file);
      const { id: uploadId, token } = await upload.finish();
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId, token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "The import didn't start");
      setState({
        step: "importing",
        projectId: body.project.id,
        name: body.project.name,
      });
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const job = await (await fetch(`/api/admin/jobs/${body.jobId}`)).json();
        if (job.status === "done") {
          setState({
            step: "done",
            projectId: body.project.id,
            name: body.project.name,
            count: body.counts.testimonials,
          });
          return;
        }
        if (job.status === "failed") throw new Error(job.error || "The import failed");
      }
    } catch (err) {
      setState({ step: "error", message: (err as Error).message });
    }
  }

  return (
    <section className={cn(card, className)} aria-labelledby={`${id}-h`} data-testid="import-project">
      <CardHead
        id={`${id}-h`}
        icon={UploadIcon}
        title="Import a project"
        text="Restore a backup, or move a project from another Plaudit server, using its export .zip."
      />
      {state.step === "uploading" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-muted-foreground">Uploading… {state.percent}%</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className="h-full origin-left rounded-full bg-primary transition-transform duration-200 ease-out"
              style={{ transform: `scaleX(${state.percent / 100})` }}
            />
          </div>
        </div>
      )}
      {state.step === "importing" && <p className="text-sm text-muted-foreground">Importing into “{state.name}”…</p>}
      {state.step === "done" && (
        <p className="text-sm text-foreground" role="status">
          Imported {state.count} testimonial{state.count === 1 ? "" : "s"} into{" "}
          <a href={`/admin/projects/${state.projectId}`} className="font-semibold text-primary underline underline-offset-3">
            {state.name}
          </a>
          .
        </p>
      )}
      {state.step === "error" && (
        <p className="error" role="alert">
          {state.message}
        </p>
      )}
      <div className="mt-auto">
        {/* A label styled as a button: the file input itself stays hidden. */}
        <label
          className={cn(
            "inline-flex h-11 cursor-pointer flex-row items-center gap-2 rounded-full border-[1.5px] border-border bg-card px-4 text-sm font-bold text-foreground transition-[border-color,translate,scale] duration-200 ease-out",
            "hover:border-foreground/40 motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.97] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
            busy && "pointer-events-none opacity-50",
          )}
        >
          <UploadIcon aria-hidden className="size-4" />
          Choose export .zip
          <input
            type="file"
            accept=".zip,application/zip"
            data-testid="import-file"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void run(file);
            }}
          />
        </label>
      </div>
    </section>
  );
}
