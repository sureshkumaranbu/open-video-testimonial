"use client";

import "@/app/admin/widgets-admin.css";
import { useState } from "react";
import { api } from "@/app/admin/api";
import { DevicePreview, Segmented, Tabs, Toast, UnsavedGuard, type Device } from "@/components/admin";
import { LAYOUT_LABELS, type WidgetConfig } from "@/lib/widget-config";
import type { AdminWidget } from "@/lib/widgets";
import { DesignPanel, LabelsPanel, LayoutPanel, SettingsPanel } from "./Panels";
import { WidgetPreview } from "./Preview";
import { SharePanel } from "./SharePanel";
import { TestimonialsPanel } from "./TestimonialsPanel";

export type StudioTab = "layout" | "testimonials" | "design" | "settings" | "labels" | "share";

export type PickItem = { id: string; name: string; rating: number | null; text: string; video: boolean };

export type Facets = { tags: string[]; forms: { id: string; name: string }[]; platforms: string[]; languages: string[] };

export type Draft = { name: string; placement: string; connectedFormId: string | null; config: WidgetConfig };

export type Update = (fn: (d: Draft) => Draft) => void;

/** Shorthand for changing one config section. */
export function setSection<K extends keyof WidgetConfig>(update: Update, key: K, patch: Partial<WidgetConfig[K]>) {
  update((d) => ({ ...d, config: { ...d.config, [key]: { ...(d.config[key] as object), ...patch } } }));
}

type Props = {
  project: { id: string; slug: string; name: string; accentColor: string };
  initial: AdminWidget;
  pickable: PickItem[];
  facets: Facets;
  origin: string;
  initialTab: StudioTab;
};

const draftOf = (w: AdminWidget): Draft => ({
  name: w.name,
  placement: w.placement ?? "",
  connectedFormId: w.connectedFormId,
  config: w.config,
});

/**
 * The widget studio (PRD §11.3): Layout · Testimonials · Design · Settings ·
 * Labels · Share on the left, and on the right the live preview at desktop,
 * tablet or phone width over a light or dark page.
 */
export function Studio({ project, initial, pickable, facets, origin, initialTab }: Props) {
  const [widget, setWidget] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [saved, setSaved] = useState(() => JSON.stringify(draftOf(initial)));
  const [tab, setTab] = useState<StudioTab>(initialTab);
  const [device, setDevice] = useState<Device>("desktop");
  const [bg, setBg] = useState<"light" | "dark">("light");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== saved;
  const update: Update = (fn) => setDraft((d) => fn(d));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { widget: next } = await api<{ widget: AdminWidget }>(`/api/admin/widgets/${widget.id}`, {
        method: "PATCH",
        json: { name: draft.name, placement: draft.placement || null, connectedFormId: draft.connectedFormId, config: draft.config },
      });
      setWidget(next);
      setDraft(draftOf(next));
      setSaved(JSON.stringify(draftOf(next)));
      setToast("Saved");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack-lg" data-testid="widget-studio">
      <UnsavedGuard dirty={dirty} />
      <div className="page-head">
        <div>
          <h1>{draft.name}</h1>
          <p className="muted small">
            {LAYOUT_LABELS[draft.config.layout].name} · <code>{widget.id}</code>
          </p>
        </div>
        <div className="row" style={{ gap: "var(--space-2)" }}>
          <a className="button secondary small" href={`/embed/${widget.id}`} target="_blank" rel="noreferrer">
            Open hosted link
          </a>
          <button type="button" className="accent" onClick={save} disabled={!dirty || saving} data-testid="save-widget">
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="ws-studio">
        <section className="ws-panel" aria-label="Widget settings">
          <Tabs
            label="Studio sections"
            value={tab}
            onChange={(t) => setTab(t as StudioTab)}
            tabs={[
              { id: "layout", label: "Layout" },
              { id: "testimonials", label: "Testimonials" },
              { id: "design", label: "Design" },
              { id: "settings", label: "Settings" },
              { id: "labels", label: "Labels" },
              { id: "share", label: "Share" },
            ]}
          >
            <div className="ws-panel" style={{ paddingTop: "var(--space-3)" }}>
              {tab === "layout" && <LayoutPanel draft={draft} update={update} />}
              {tab === "testimonials" && <TestimonialsPanel draft={draft} update={update} pickable={pickable} facets={facets} />}
              {tab === "design" && <DesignPanel draft={draft} update={update} accent={project.accentColor} />}
              {tab === "settings" && <SettingsPanel draft={draft} update={update} forms={facets.forms} />}
              {tab === "labels" && <LabelsPanel draft={draft} update={update} />}
              {tab === "share" && <SharePanel widgetId={widget.id} name={draft.name} origin={origin} dirty={dirty} />}
            </div>
          </Tabs>
        </section>
        <section className="ws-preview" aria-label="Preview">
          <div className="ws-preview-bar">
            <Segmented
              label="Page behind the preview"
              options={[
                { value: "light", label: "Light page" },
                { value: "dark", label: "Dark page" },
              ]}
              value={bg}
              onChange={setBg}
              testId="preview-bg"
            />
          </div>
          <DevicePreview device={device} onDevice={setDevice} label="Widget preview" testId="widget-preview">
            <div className="ws-stage" data-bg={bg}>
              <WidgetPreview projectId={project.id} connectedFormId={draft.connectedFormId} config={draft.config} />
            </div>
          </DevicePreview>
          <p className="muted xsmall">The preview runs the real embed code with your unsaved changes. Save to update your site.</p>
        </section>
      </div>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
