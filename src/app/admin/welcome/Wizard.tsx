"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/app/admin/api";
import { ProgressBar } from "@/components/admin/ProgressBar";
import { useRunProgress } from "@/components/admin/RunProgress";
import { Icon } from "@/components/Icon";
import "@/app/admin/onboarding.css";

type Item = { id: string; authorName: string; authorTitle: string | null; authorCompany: string | null; rating: number | null; text: string | null };
type Discovery = { runId: string | null; items: Item[]; brand: { name?: string; color?: string } | null; error: string | null };
type Created = { project: { id: string; slug: string; name: string }; scan: { id: string } | null };
type Run = { status: string; done: number; total: number; duplicates: number; failed: number };

/** What the brand scan is doing, by how many of its three steps are done. */
const SCAN_STEPS = ["Reading your site…", "Looking at your logo and colours…", "Saving what we found…"];

/**
 * ONB-01..03: name, website and business type; then the brand scan's
 * progress (it runs in the background, so the owner can move on and the
 * brand still lands on the project); then what we found on the site to
 * choose from; then done. Every step can be skipped.
 */
export function Wizard({ businessTypes, emailOn }: { businessTypes: { id: string; label: string }[]; emailOn: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"about" | "scanning" | "found" | "importing" | "done">("about");
  const [created, setCreated] = useState<Created | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState(0);
  const [runId, setRunId] = useState<string | null>(null);
  /** The owner went on before the scan finished: what it finds is offered on the last step. */
  const [movedOn, setMovedOn] = useState(false);
  const scanId = created?.scan?.id ?? null;
  const { run: scan } = useRunProgress(scanId, { intervalMs: 700 });

  // Once the scan ends, fetch what it found: straight to the list while the
  // wizard waits for it, or as an offer on the last step if the owner moved on.
  const scanFinished = Boolean(scan?.finished);
  useEffect(() => {
    if (!scanFinished || !scanId || !created) return;
    let stop = false;
    void api<{ discovery: Discovery | null }>(`/api/admin/onboarding/discover?projectId=${encodeURIComponent(created.project.id)}&runId=${encodeURIComponent(scanId)}`)
      .then(({ discovery: d }) => {
        if (stop || !d) return;
        setDiscovery(d);
        setChosen(d.items.map((i) => i.id));
        setStep((s) => (s === "scanning" ? "found" : s));
      })
      .catch(() => {
        if (!stop) setStep((s) => (s === "scanning" ? "done" : s));
      });
    return () => {
      stop = true;
    };
  }, [scanFinished, scanId, created]);

  // Follow the import until it ends (it runs in the background worker).
  useEffect(() => {
    if (step !== "importing" || !runId) return;
    let stop = false;
    const tick = async () => {
      try {
        const { run } = await api<{ run: Run }>(`/api/admin/runs/${runId}`);
        if (stop) return;
        if (run.status === "done" || run.status === "failed") {
          setImported(run.done);
          setStep("done");
          return;
        }
      } catch {
        // Try again on the next tick.
      }
      if (!stop) setTimeout(tick, 700);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [step, runId]);

  if (step === "about") {
    return (
      <form
        className="panel ob-wizard stack"
        data-testid="welcome-wizard"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setBusy(true);
          setError(null);
          try {
            const res = await api<Created>("/api/admin/onboarding", {
              method: "POST",
              json: {
                name: form.get("name"),
                website: String(form.get("website") ?? ""),
                businessType: form.get("businessType"),
                emailMe: form.get("emailMe") === "on",
              },
            });
            setCreated(res);
            setStep(res.scan ? "scanning" : "done");
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="panel-body stack">
          <label>
            Project name
            <input type="text" name="name" required maxLength={80} placeholder="Your product or business" autoComplete="organization" />
          </label>
          <label>
            Your website <span className="hint">(optional: we look for your logo, colour and testimonials already there)</span>
            <input type="text" name="website" inputMode="url" maxLength={500} placeholder="example.com" autoComplete="url" />
          </label>
          <label>
            What do you sell?
            <select name="businessType" defaultValue="saas">
              {businessTypes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
            <span className="hint xsmall">This only changes the wording of your first form.</span>
          </label>
          <label className="check small">
            <input type="checkbox" name="emailMe" defaultChecked />
            Email me new testimonials{emailOn ? "" : " (once email is set up on this server)"}
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="submit" disabled={busy}>
              {busy ? "Setting up…" : "Continue"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                await api("/api/admin/onboarding", { method: "POST", json: { skip: true } }).catch(() => null);
                router.push("/admin");
              }}
            >
              Skip setup
            </button>
          </div>
        </div>
      </form>
    );
  }

  const project = created!.project;
  const goToProject = () => router.push(`/admin/projects/${project.id}`);

  if (step === "scanning") {
    return (
      <section className="panel ob-wizard" data-testid="welcome-scanning" aria-labelledby="scan-h" aria-busy="true">
        <div className="panel-head">
          <h2 id="scan-h" style={{ fontSize: "var(--text-base)" }}>
            Looking at your site
          </h2>
        </div>
        <div className="panel-body stack">
          <div role="status" aria-live="polite">
            <ProgressBar
              label="Brand and testimonials"
              value={scan?.percent ?? null}
              detail={scan?.status === "queued" || !scan ? "Starting…" : SCAN_STEPS[Math.min(scan.done, SCAN_STEPS.length - 1)]}
              testId="welcome-scan-progress"
            />
          </div>
          <p className="muted small">This takes up to 30 seconds. Your project is ready: you can carry on, and your logo and colour are added when it&apos;s done.</p>
          <div className="row">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setMovedOn(true);
                setStep("done");
              }}
            >
              Continue without waiting
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (step === "found" && discovery) {
    const d = discovery;
    const all = d.items.length > 0 && chosen.length === d.items.length;
    return (
      <section className="panel ob-wizard" data-testid="welcome-found" aria-labelledby="found-h">
        <div className="panel-head">
          <h2 id="found-h" style={{ fontSize: "var(--text-base)" }}>
            {d.items.length ? `We found ${d.items.length} ${d.items.length === 1 ? "testimonial" : "testimonials"} on your site` : "No testimonials found on your site"}
          </h2>
        </div>
        <div className="panel-body stack">
          {d.error && <p className="notice warn small">{d.error}</p>}
          {d.brand?.color && (
            <p className="small" data-testid="welcome-brand">
              <span className="ob-swatch" style={{ background: d.brand.color }} aria-hidden="true" />
              Your form, wall and widgets now use your colour, {d.brand.color}.
            </p>
          )}
          {d.items.length === 0 ? (
            <p className="muted small">
              That&apos;s fine: you can import reviews from Google, Trustpilot and others, or send your form link to customers. Your
              project is ready.
            </p>
          ) : (
            <>
              <p className="muted small">They&apos;ll be added as approved, so they can show on your site straight away.</p>
              <div className="row">
                <button type="button" className="ghost small" onClick={() => setChosen(d.items.map((i) => i.id))} disabled={all}>
                  Select all
                </button>
                <button type="button" className="ghost small" onClick={() => setChosen([])} disabled={chosen.length === 0}>
                  Clear
                </button>
              </div>
              <ul className="ob-found">
                {d.items.map((i) => (
                  <li key={i.id} data-testid="welcome-found-item">
                    <label className="ob-found-item">
                      <input
                        type="checkbox"
                        checked={chosen.includes(i.id)}
                        onChange={(e) => setChosen(e.target.checked ? [...chosen, i.id] : chosen.filter((x) => x !== i.id))}
                        aria-label={`Import the testimonial from ${i.authorName}`}
                      />
                      <span>
                        <strong>{i.authorName}</strong>
                        {(i.authorTitle || i.authorCompany) && <span className="muted xsmall"> · {[i.authorTitle, i.authorCompany].filter(Boolean).join(", ")}</span>}
                        {i.rating ? <span className="ob-stars" aria-label={`${i.rating} out of 5 stars`}> {"★".repeat(i.rating)}</span> : null}
                        <span className="ob-quote">{i.text}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            {d.items.length > 0 && (
              <button
                type="button"
                disabled={busy || chosen.length === 0}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const { run } = await api<{ run: { id: string } }>("/api/admin/onboarding/import", {
                      method: "POST",
                      json: { projectId: project.id, runId: d.runId, selection: all ? "all" : chosen },
                    });
                    setRunId(run.id);
                    setStep("importing");
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Import {chosen.length} as approved
              </button>
            )}
            <button type="button" className={d.items.length ? "ghost" : undefined} onClick={() => setStep("done")}>
              {d.items.length ? "Skip this step" : "Continue"}
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (step === "importing") {
    return (
      <section className="panel ob-wizard" aria-busy="true">
        <div className="panel-body">
          <p role="status" aria-live="polite">
            Importing your testimonials…
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel ob-wizard" data-testid="welcome-done" aria-labelledby="done-h">
      <div className="panel-head">
        <h2 id="done-h" style={{ fontSize: "var(--text-base)" }}>
          {project.name} is ready
        </h2>
      </div>
      <div className="panel-body stack">
        <p role="status" className="small">
          {imported ? `${imported} ${imported === 1 ? "testimonial" : "testimonials"} imported. ` : ""}We made a step-by-step collection form, a Wall of
          Love and two widgets (a grid and a carousel) in your colours.
        </p>
        {movedOn && !scan?.finished && (
          <p className="muted small" role="status" data-testid="welcome-scan-pending">
            We&apos;re still looking at your site. Your logo and colour are added when that&apos;s done, even if you leave this page.
          </p>
        )}
        {movedOn && discovery && discovery.items.length > 0 && !runId && (
          <div className="notice small row" data-testid="welcome-found-later">
            <span>
              We found {discovery.items.length} {discovery.items.length === 1 ? "testimonial" : "testimonials"} on your site.
            </span>
            <button
              type="button"
              className="ghost small"
              onClick={() => {
                setMovedOn(false);
                setStep("found");
              }}
            >
              Review them
            </button>
          </div>
        )}
        <ul className="ob-made small">
          <li>
            <Icon name="link" /> <a href={`/admin/projects/${project.id}/forms`}>Your collection form</a>
          </li>
          <li>
            <Icon name="layout" /> <a href={`/admin/projects/${project.id}/widgets`}>Your widgets</a>
          </li>
          <li>
            <Icon name="globe" /> <a href={`/admin/projects/${project.id}/walls`}>Your Wall of Love</a>
          </li>
        </ul>
        <div>
          <button type="button" onClick={goToProject}>
            Go to your project
          </button>
        </div>
      </div>
    </section>
  );
}
