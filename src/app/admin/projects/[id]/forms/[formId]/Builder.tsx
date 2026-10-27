"use client";

import "@/app/admin/forms-admin.css";
import { useMemo, useState } from "react";
import { api } from "@/app/admin/api";
import { DevicePreview, Tabs, Toast, UnsavedGuard, type Device } from "@/components/admin";
import { FormRunner } from "@/components/collect/FormRunner";
import { designWithBrand } from "@/lib/forms/design";
import { resolveLabels } from "@/lib/forms/labels";
import type { FormConfig, FormPage, PublicForm } from "@/lib/forms/schema";
import type { Brand } from "@/lib/validation";
import type { FormRow } from "../types";
import { ContentEditor, PageList } from "./ContentEditor";
import { DesignEditor } from "./DesignEditor";
import { SettingsEditor } from "./SettingsEditor";
import { SharePanel } from "./SharePanel";

export type BuilderTab = "content" | "design" | "settings" | "share";

export type Draft = Pick<FormConfig, "pages" | "design" | "labels" | "settings"> & { name: string; language: string };

export type BuilderProject = {
  id: string;
  slug: string;
  name: string;
  accentColor: string;
  brand: Brand;
  logoUrl: string | null;
};

type Props = {
  project: BuilderProject;
  initial: FormRow;
  limits: { maxVideoBytes: number; maxImageBytes: number };
  initialTab: BuilderTab;
};

const draftOf = (f: FormRow): Draft => ({
  name: f.name,
  language: f.language,
  pages: f.config.pages,
  design: f.config.design,
  labels: f.config.labels,
  settings: f.config.settings,
});

/** What counts as a change: autoApprove.since is the server's bookkeeping, not something the owner edits. */
const fingerprint = (d: Draft) => JSON.stringify({ ...d, settings: { ...d.settings, autoApprove: { ...d.settings.autoApprove, since: null } } });

/**
 * The form builder (FORM-02): the page list on the left, the live preview in
 * the middle (the real FormRunner, so it matches the public page) and the
 * selected page's or tab's settings on the right. Every change previews at
 * once; leaving warns only when something is unsaved.
 */
export function Builder({ project, initial, limits, initialTab }: Props) {
  const [form, setForm] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [saved, setSaved] = useState(() => fingerprint(draftOf(initial)));
  const [tab, setTab] = useState<BuilderTab>(initialTab);
  const [selected, setSelected] = useState(() => Math.max(0, initial.config.pages.findIndex((p) => p.type === "question")));
  const [device, setDevice] = useState<Device>("mobile");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dirty = fingerprint(draft) !== saved;

  const labels = useMemo(() => resolveLabels(draft.language, draft.labels.overrides), [draft.language, draft.labels.overrides]);
  const preview: PublicForm = useMemo(
    () => ({
      id: form.id,
      slug: form.slug,
      name: draft.name,
      status: form.status,
      layout: form.layout,
      language: draft.language,
      logoUrl: form.logoUrl,
      pages: draft.pages,
      design: designWithBrand(draft.design, project.brand),
      labels: draft.labels,
      settings: { closedMessage: draft.settings.closedMessage, landscapePrompt: draft.settings.landscapePrompt },
    }),
    [form, draft, project.brand],
  );
  const consentPage = draft.pages.find((p) => p.type === "consent");
  const wording = ((consentPage?.type === "consent" && consentPage.text.trim()) || labels.consentDefault).replaceAll("{project}", project.name);

  /** The server's copy replaces ours (after a save or an action). */
  function adopt(next: FormRow, keepDraft = false) {
    setForm(next);
    if (!keepDraft) {
      setDraft(draftOf(next));
      setSaved(fingerprint(draftOf(next)));
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { form: next } = await api<{ form: FormRow }>(`/api/admin/forms/${form.id}`, { method: "PATCH", json: draft });
      adopt(next);
      setToast("Saved");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** Actions that change the form on the server straight away (status, link, layout, default, logo). */
  async function action(path: string, init: Parameters<typeof api>[1], done?: string) {
    setError(null);
    try {
      const { form: next } = await api<{ form: FormRow }>(path, init);
      adopt(next, true);
      if (done) setToast(done);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const update = (fn: (d: Draft) => Draft) => setDraft((d) => fn(d));
  const setPages = (pages: FormPage[]) => update((d) => ({ ...d, pages }));

  return (
    <div className="fb-builder-wrap stack-lg" data-testid="form-builder">
      <UnsavedGuard dirty={dirty} />
      <div className="page-head">
        <div>
          <h1>{draft.name}</h1>
          <p className="muted small">
            {form.isDefault ? "Default form · " : ""}
            {form.status === "paused" ? "Paused" : "Live"} · {form.layout === "classic" ? "Classic page" : "Step by step"}
          </p>
        </div>
        <div className="row" style={{ gap: "var(--space-2)" }}>
          <a className="button secondary small" href={form.links.hosted} target="_blank" rel="noreferrer">
            Open form
          </a>
          <button type="button" className="accent" onClick={save} disabled={!dirty || saving} data-testid="save-form">
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </div>
      {form.layout === "classic" && (
        <div className="notice fb-classic" data-testid="classic-notice">
          <p>
            This form uses the classic one-page layout, so it can show one question and the standard details only. Switch to
            step by step for more questions, custom fields, languages and design.
            {form.isDefault ? " Its /c link then sends visitors to the new page." : ""}
          </p>
          <button
            type="button"
            className="secondary small"
            disabled={dirty}
            title={dirty ? "Save or undo your changes first" : undefined}
            onClick={() => action(`/api/admin/forms/${form.id}/upgrade`, { method: "POST" }, "Switched to step by step")}
          >
            Switch to step-by-step
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Tabs
        label="Builder sections"
        value={tab}
        onChange={(t) => setTab(t as BuilderTab)}
        tabs={[
          { id: "content", label: "Content" },
          { id: "design", label: "Design" },
          { id: "settings", label: "Settings" },
          { id: "share", label: "Share" },
        ]}
      >
        <div className="fb-builder">
          <aside className="fb-pages" aria-label="Pages">
            <PageList pages={draft.pages} selected={selected} onSelect={setSelected} onChange={setPages} editable={tab === "content"} />
          </aside>
          <section className="fb-preview" aria-label="Preview">
            <DevicePreview device={device} onDevice={setDevice} label="Form preview" testId="form-preview">
              <FormRunner
                project={{ slug: project.slug, name: project.name }}
                form={preview}
                labels={labels}
                consent={{ versionId: null, text: wording }}
                prefill={{ person: {}, locked: [], hidden: {} }}
                logoUrl={form.logoUrl ?? project.logoUrl}
                accent={project.accentColor}
                limits={limits}
                preview
                previewPage={selected}
              />
            </DevicePreview>
            <p className="muted xsmall">The preview is the real form; recording and sending are off here.</p>
          </section>
          <section className="fb-panel" aria-label="Settings for this section">
            {tab === "content" && <ContentEditor draft={draft} index={selected} onChange={setPages} />}
            {tab === "design" && (
              <DesignEditor
                draft={draft}
                update={update}
                brand={project.brand}
                accent={project.accentColor}
                logoUrl={form.logoUrl}
                onLogo={(file) => {
                  const data = new FormData();
                  if (file) data.set("logo", file);
                  return action(`/api/admin/forms/${form.id}/logo`, file ? { method: "POST", body: data } : { method: "DELETE" }, file ? "Logo saved" : "Logo removed");
                }}
              />
            )}
            {tab === "settings" && (
              <SettingsEditor
                project={project}
                form={form}
                draft={draft}
                update={update}
                dirty={dirty}
                onAction={action}
              />
            )}
            {tab === "share" && <SharePanel form={form} accent={draft.design.primary ?? project.brand.colors.primary ?? project.accentColor} />}
          </section>
        </div>
      </Tabs>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
