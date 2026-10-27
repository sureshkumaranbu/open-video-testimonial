"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { ConfirmDialog, CopyField, Field, Toast, UnsavedGuard } from "@/components/admin";
import { Icon } from "@/components/Icon";
import type { SlugCheck, TagUsage } from "@/lib/projects";
import type { Brand } from "@/lib/validation";
import { BrandKit } from "./BrandKit";
import { DangerZone } from "./DangerZone";
import { TagsManager } from "./TagsManager";
import "@/app/admin/project-settings.css";

/** What the settings page needs of a project (it never sees the form columns). */
export type SettingsProject = {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  businessType: string | null;
  logoKey: string | null;
  accentColor: string;
};

/** An old link, as GET …/redirects sends it. */
export type RedirectRow = {
  id: string;
  kind: "project" | "form" | "wall";
  oldSlug: string;
  oldPath: string;
  target: string;
  createdAt: string;
};

type Props = {
  project: SettingsProject;
  brand: Brand;
  tags: TagUsage[];
  redirects: RedirectRow[];
  isOwner: boolean;
  publicUrl: string;
};

/** Our own names for the onboarding question "what kind of business"; stored as the id. */
const BUSINESS_TYPES: readonly [string, string][] = [
  ["", "Not set"],
  ["saas", "Software or app"],
  ["agency", "Agency or studio"],
  ["ecommerce", "Online shop"],
  ["local", "Local business"],
  ["course", "Course or education"],
  ["coaching", "Coaching or consulting"],
  ["other", "Something else"],
];

/**
 * Project settings (TEAM-04): details, the link and its old links, the brand
 * kit, tags and deleting the project. Each section saves on its own; leaving
 * with unsaved details or brand changes asks first.
 */
export function ProjectSettings({ project: initial, brand, tags, redirects: initialRedirects, isOwner, publicUrl }: Props) {
  const router = useRouter();
  const [project, setProject] = useState(initial);
  const [redirects, setRedirects] = useState(initialRedirects);
  const [dirty, setDirty] = useState({ details: false, brand: false });
  const [toast, setToast] = useState<string | null>(null);

  const markDirty = useCallback(
    (part: "details" | "brand", value: boolean) => setDirty((d) => (d[part] === value ? d : { ...d, [part]: value })),
    [],
  );
  const onDetailsDirty = useCallback((v: boolean) => markDirty("details", v), [markDirty]);
  const onBrandDirty = useCallback((v: boolean) => markDirty("brand", v), [markDirty]);

  /** Keeps the rest of the page (the breadcrumb's name, the tabs' links) in step with a saved change. */
  function saved(patch: Partial<SettingsProject>, message: string) {
    setProject((p) => ({ ...p, ...patch }));
    setToast(message);
    router.refresh();
  }

  return (
    <div className="stack-lg ps-root" data-testid="project-settings">
      <UnsavedGuard dirty={dirty.details || dirty.brand} />
      <DetailsPanel project={project} onSaved={saved} onDirty={onDetailsDirty} />
      <LinkPanel
        project={project}
        publicUrl={publicUrl}
        redirects={redirects}
        onRedirects={setRedirects}
        onSlug={(slug, message) => saved({ slug }, message)}
        onToast={setToast}
      />
      <BrandKit
        projectId={project.id}
        logoKey={project.logoKey}
        accentColor={project.accentColor}
        brand={brand}
        onDirty={onBrandDirty}
        onLogo={(logoKey, message) => saved({ logoKey }, message)}
        onSaved={(message) => saved({}, message)}
      />
      <TagsManager projectId={project.id} tags={tags} onToast={setToast} />
      <DangerZone projectId={project.id} name={project.name} isOwner={isOwner} />
      <Toast message={toast} onDismiss={() => setToast(null)} testId="settings-toast" />
    </div>
  );
}

// ---------------------------------------------------------------- details

function DetailsPanel({
  project,
  onSaved,
  onDirty,
}: {
  project: SettingsProject;
  onSaved: (patch: Partial<SettingsProject>, message: string) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(project.name);
  const [website, setWebsite] = useState(project.website ?? "");
  const [businessType, setBusinessType] = useState(project.businessType ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = name !== project.name || website !== (project.website ?? "") || businessType !== (project.businessType ?? "");
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  // A value saved through the API keeps its own (unlisted) business type.
  const types = BUSINESS_TYPES.some(([id]) => id === businessType) ? BUSINESS_TYPES : [...BUSINESS_TYPES, [businessType, businessType] as [string, string]];

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { project: p } = await api<{ project: SettingsProject }>(`/api/admin/projects/${project.id}`, {
        method: "PATCH",
        json: { name, website, businessType },
      });
      setName(p.name);
      setWebsite(p.website ?? "");
      setBusinessType(p.businessType ?? "");
      onSaved({ name: p.name, website: p.website, businessType: p.businessType }, "Details saved");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel" aria-labelledby="ps-details-h" onSubmit={save} data-testid="project-details">
      <div className="panel-head">
        <h2 id="ps-details-h" className="ps-title">
          <Icon name="pen" />
          Details
        </h2>
      </div>
      <div className="panel-body stack">
        <div className="ps-fields">
          <Field label="Project name" hint="Shown on your collection page, wall and emails.">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </Field>
          <Field label="Website" optional hint="Your product's own site, such as https://acme.com.">
            <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={2000} placeholder="https://" inputMode="url" />
          </Field>
          <Field label="Kind of business" optional>
            <select value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
              {types.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" disabled={!dirty || saving || !name.trim()}>
            {saving ? "Saving…" : "Save details"}
          </button>
        </div>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------- link

function LinkPanel({
  project,
  publicUrl,
  redirects,
  onRedirects,
  onSlug,
  onToast,
}: {
  project: SettingsProject;
  publicUrl: string;
  redirects: RedirectRow[];
  onRedirects: (r: RedirectRow[]) => void;
  onSlug: (slug: string, message: string) => void;
  onToast: (message: string) => void;
}) {
  const [slug, setSlug] = useState(project.slug);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set while the change is being confirmed. */
  const [pending, setPending] = useState<SlugCheck | null>(null);
  const [removing, setRemoving] = useState<RedirectRow | null>(null);
  const base = publicUrl.replace(/\/+$/, "");
  const host = base.replace(/^https?:\/\//, "");
  const next = slug.trim().toLowerCase();
  const changed = next !== "" && next !== project.slug;

  async function review(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!changed) return;
    setChecking(true);
    setError(null);
    try {
      const check = await api<SlugCheck>(`/api/admin/projects/${project.id}/slug?slug=${encodeURIComponent(next)}`);
      if (check.available) setPending(check);
      else setError(check.error ?? "That link isn't available. Pick a different one.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  }

  async function change() {
    const { project: p, warning } = await api<{ project: SettingsProject; warning?: string }>(`/api/admin/projects/${project.id}/slug`, {
      method: "POST",
      json: { slug: pending!.slug },
    });
    const { redirects: list } = await api<{ redirects: RedirectRow[] }>(`/api/admin/projects/${project.id}/redirects`);
    setSlug(p.slug);
    onRedirects(list);
    onSlug(p.slug, warning ?? "Link changed. Old links still work.");
  }

  async function remove() {
    const target = removing!;
    await api(`/api/admin/redirects/${target.id}`, { method: "DELETE" });
    onRedirects(redirects.filter((r) => r.id !== target.id));
    onToast(`${target.oldPath} no longer works`);
  }

  return (
    <section className="panel" aria-labelledby="ps-link-h" data-testid="project-link">
      <div className="panel-head">
        <h2 id="ps-link-h" className="ps-title">
          <Icon name="link" />
          Link
        </h2>
      </div>
      <div className="panel-body stack">
        <CopyField label="Collection page" value={`${base}/c/${project.slug}`} copyLabel="Copy link" testId="collect-link" />
        <form className="stack" onSubmit={review}>
          <Field
            label="Link name"
            hint={
              <>
                Every public link uses it: <span className="ps-url">{`${host}/c/${next || "…"}`}</span>, the wall, iframe embeds and the
                widget script. Lowercase letters, numbers and dashes.
              </>
            }
            error={error}
          >
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setError(null);
              }}
              maxLength={48}
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <div className="row">
            <button type="submit" className="secondary" disabled={!changed || checking}>
              {checking ? "Checking…" : "Change link…"}
            </button>
          </div>
        </form>

        <div className="stack ps-old-links">
          <h3 className="ps-subtitle">Old links</h3>
          {redirects.length === 0 ? (
            <p className="muted small">None yet. When you change a link, the old one keeps working and shows up here.</p>
          ) : (
            <>
              <p className="muted small">These still work: they send people on to the current link.</p>
              <ul className="ps-list" aria-label="Old links">
                {redirects.map((r) => (
                  <li key={r.id} className="ps-list-row" data-testid="redirect-row">
                    <span className="ps-list-main">
                      <code className="ps-url">{r.oldPath}</code>
                      <span className="muted small">opens {r.target}</span>
                    </span>
                    <button type="button" className="ghost small" onClick={() => setRemoving(r)} aria-label={`Remove old link ${r.oldPath}`}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={change}
        title="Change the link?"
        confirmLabel="Change link"
        busyLabel="Changing…"
        testId="change-link-dialog"
      >
        {pending && (
          <>
            <p>
              The collection page becomes <span className="ps-url">/c/{pending.slug}</span>, and the wall, embeds and widget follow.
            </p>
            <p>
              Old links keep working: <span className="ps-url">/c/{project.slug}</span> sends people to the new one, so links in emails and
              embed codes on other sites don&apos;t break.
            </p>
            {pending.replacesAliasOf && (
              <p className="notice warn">
                “{pending.slug}” is an old link of {pending.replacesAliasOf.name}. Those old links will open this project instead.
              </p>
            )}
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title="Remove this old link?"
        confirmLabel="Remove link"
        busyLabel="Removing…"
        danger
        testId="remove-link-dialog"
      >
        {removing && (
          <p>
            <span className="ps-url">{removing.oldPath}</span> will stop working and show “not found”. Emails, QR codes and embeds that still
            use it will break.
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}
