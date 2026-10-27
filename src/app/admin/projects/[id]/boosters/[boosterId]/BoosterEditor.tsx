"use client";

import "@/app/admin/boosters.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { ColorField, CopyField, DevicePreview, EmptyState, Segmented, Tabs, Toast, Toggle, UnsavedGuard, type Device } from "@/components/admin";
import { QrStudio } from "@/components/admin/QrStudio";
import { Icon } from "@/components/Icon";
import {
  BOOSTER_PLATFORMS,
  BUTTON_STYLES,
  boosterCss,
  boosterMarkup,
  defaultBoosterTitle,
  googleReviewLink,
  INCENTIVE_WORDS,
  MAX_BOOSTER_LINKS,
  platformIconSvg,
  PLATFORMS,
  type BoosterDesign,
  type BoosterLink,
  type BoosterPlatform,
  type BoosterView,
  type ButtonStyle,
} from "@/lib/booster-config";
import type { AdminBooster, ClickStats } from "@/lib/boosters";

type FormChoice = { id: string; name: string; url: string };
type Props = {
  project: { id: string; slug: string; name: string; logoUrl: string | null };
  initial: AdminBooster;
  forms: FormChoice[];
  /** GOOGLE_PLACES_API_KEY is set, so business search works (BOOST-02). */
  placesSearch: boolean;
};

type Draft = Pick<AdminBooster, "name" | "title" | "message" | "links" | "design">;
type Section = "links" | "look" | "share" | "clicks";

const draftOf = (b: AdminBooster): Draft => ({ name: b.name, title: b.title, message: b.message, links: b.links, design: b.design });
const STYLE_NAMES: Record<ButtonStyle, string> = { solid: "Solid", outline: "Outline", soft: "Soft" };
const newId = () => Math.random().toString(36).slice(2, 10);

/**
 * The review booster editor (BOOST-01..05): Links · Look · Share · Clicks on
 * the left, and on the right the live preview, which is the public page's own
 * markup and styles (the same renderer) at phone or desktop width.
 */
export function BoosterEditor({ project, initial, forms, placesSearch }: Props) {
  const [booster, setBooster] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [saved, setSaved] = useState(() => JSON.stringify(draftOf(initial)));
  const [section, setSection] = useState<Section>("links");
  const [device, setDevice] = useState<Device>("mobile");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== saved;
  const setDesign = (patch: Partial<BoosterDesign>) => setDraft((d) => ({ ...d, design: { ...d.design, ...patch } }));

  const adopt = (b: AdminBooster, keepDraft = false) => {
    setBooster(b);
    if (!keepDraft) {
      setDraft(draftOf(b));
      setSaved(JSON.stringify(draftOf(b)));
    }
  };

  async function save() {
    setSaving(true);
    setError(null);
    try {
      adopt((await api<{ booster: AdminBooster }>(`/api/admin/boosters/${booster.id}`, { method: "PATCH", json: draft })).booster);
      setToast("Saved");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function setPublished(published: boolean) {
    setError(null);
    try {
      // Unsaved changes go with it, so what becomes public is what the preview shows.
      const json = dirty ? { ...draft, published } : { published };
      adopt((await api<{ booster: AdminBooster }>(`/api/admin/boosters/${booster.id}`, { method: "PATCH", json })).booster);
      setToast(published ? "The page is public" : "Back to draft: the page is hidden");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // The preview: the public page's renderer with the unsaved draft; links go straight to their targets.
  const view: BoosterView = useMemo(
    () => ({
      title: draft.title.trim() || defaultBoosterTitle(project.name),
      message: draft.message.trim(),
      projectName: project.name,
      logoUrl: booster.logoUrl ?? project.logoUrl,
      design: draft.design,
      links: draft.links.flatMap((l) => {
        const href = l.platform === "form" ? forms.find((f) => f.id === l.formId)?.url : l.url;
        return href ? [{ id: l.id, platform: l.platform, label: l.label.trim() || PLATFORMS[l.platform].label, href }] : [];
      }),
    }),
    [draft, project, booster.logoUrl, forms],
  );
  const html = useMemo(() => `<style>${boosterCss(view.design)}</style>${boosterMarkup(view, { preview: true })}`, [view]);
  const incentive = INCENTIVE_WORDS.test(`${draft.title} ${draft.message} ${draft.links.map((l) => l.label).join(" ")}`);

  return (
    <div className="stack-lg" data-testid="booster-editor">
      <UnsavedGuard dirty={dirty} />
      <div className="page-head">
        <div>
          <h1>{draft.name}</h1>
          <p className="muted small">
            <span className="bs-badge" data-state={booster.published ? "public" : "draft"} data-testid="booster-status">
              {booster.published ? "Public" : "Draft"}
            </span>{" "}
            <code>{booster.url}</code>
          </p>
        </div>
        <div className="row" style={{ gap: "var(--space-2)" }}>
          {booster.published && (
            <a className="button secondary small" href={booster.url} target="_blank" rel="noreferrer">
              <Icon name="external" />
              View
            </a>
          )}
          <button type="button" className="accent" onClick={save} disabled={!dirty || saving} data-testid="save-booster">
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="bs-editor">
        <section className="bs-panel" aria-label="Booster settings">
          <Tabs
            label="Editor sections"
            value={section}
            onChange={(s) => setSection(s as Section)}
            tabs={[
              { id: "links", label: "Links" },
              { id: "look", label: "Look" },
              { id: "share", label: "Share" },
              { id: "clicks", label: "Clicks" },
            ]}
          >
            <div className="bs-fields">
              {section === "links" && (
                <>
                  <label>
                    Page name <span className="muted xsmall">(only you see it)</span>
                    <input type="text" value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </label>
                  <label>
                    Title
                    <input type="text" value={draft.title} maxLength={120} placeholder={defaultBoosterTitle(project.name)} onChange={(e) => setDraft({ ...draft, title: e.target.value })} data-testid="booster-title" />
                  </label>
                  <label>
                    Message
                    <textarea rows={3} value={draft.message} maxLength={600} onChange={(e) => setDraft({ ...draft, message: e.target.value })} data-testid="booster-message" />
                  </label>
                  {incentive && (
                    <p className="notice warn small" role="status" data-testid="booster-incentive-warning">
                      This reads like you&apos;re offering something for a review. Google, Trustpilot and most review sites forbid that,
                      and it can get reviews removed. Offer rewards for private testimonials in a form instead.
                    </p>
                  )}
                  <LinksEditor links={draft.links} onChange={(links) => setDraft({ ...draft, links })} forms={forms} placesSearch={placesSearch} />
                  <p className="muted xsmall">
                    Every visitor sees every link, in this order. There&apos;s no rating step and nothing is hidden: review sites
                    don&apos;t allow asking only happy customers.
                  </p>
                </>
              )}
              {section === "look" && (
                <>
                  <LogoField booster={booster} projectLogo={project.logoUrl} onBooster={(b) => adopt(b, true)} onError={setError} />
                  <Toggle label="Show the logo" checked={draft.design.showLogo} onChange={(showLogo) => setDesign({ showLogo })} />
                  <div className="bs-pair">
                    <ColorField label="Background" value={draft.design.background} onChange={(background) => setDesign({ background: background || "#f6f7fb" })} />
                    <ColorField label="Text" value={draft.design.text} allowEmpty placeholder="#161b2e" onChange={(text) => setDesign({ text })} contrastWith={draft.design.background} hint="Empty picks a readable one." />
                    <ColorField label="Buttons" value={draft.design.button} onChange={(button) => setDesign({ button: button || "#161b2e" })} />
                    <ColorField
                      label="Button text"
                      value={draft.design.buttonText}
                      allowEmpty
                      placeholder="#ffffff"
                      onChange={(buttonText) => setDesign({ buttonText })}
                      contrastWith={draft.design.buttonStyle === "solid" ? draft.design.button : draft.design.background}
                      hint="Empty picks a readable one."
                    />
                  </div>
                  <div>
                    <span className="small">Button style</span>
                    <Segmented
                      label="Button style"
                      options={BUTTON_STYLES.map((s) => ({ value: s, label: STYLE_NAMES[s] }))}
                      value={draft.design.buttonStyle}
                      onChange={(buttonStyle) => setDesign({ buttonStyle })}
                    />
                  </div>
                  <label>
                    Corner radius ({draft.design.radius} px)
                    <input type="range" min={0} max={24} value={draft.design.radius} onChange={(e) => setDesign({ radius: Number(e.target.value) })} />
                  </label>
                </>
              )}
              {section === "share" && (
                <ShareSection booster={booster} project={project} dirty={dirty} onPublished={setPublished} onBooster={(b) => adopt(b, true)} onError={setError} onDone={setToast} />
              )}
              {section === "clicks" && <ClicksSection booster={booster} />}
            </div>
          </Tabs>
        </section>
        <section className="bs-preview" aria-label="Preview">
          <DevicePreview device={device} onDevice={setDevice} label="Booster preview" testId="booster-preview">
            <div className="bs-frame" dangerouslySetInnerHTML={{ __html: html }} />
          </DevicePreview>
          <p className="muted xsmall">The preview is the real page with your unsaved changes. Its buttons open the review sites directly; on the public page each click is counted first.</p>
        </section>
      </div>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function Svg({ platform }: { platform: BoosterPlatform }) {
  return <span className="bs-icon" aria-hidden dangerouslySetInnerHTML={{ __html: platformIconSvg(platform) }} />;
}

/** BOOST-01: up to 10 links; drag a row by its handle, or use the arrows, to reorder. */
function LinksEditor({ links, onChange, forms, placesSearch }: { links: BoosterLink[]; onChange: (l: BoosterLink[]) => void; forms: FormChoice[]; placesSearch: boolean }) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const set = (i: number, patch: Partial<BoosterLink>) => onChange(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= links.length || from === to) return;
    const next = [...links];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  const add = (platform: BoosterPlatform) =>
    onChange([...links, { id: newId(), platform, label: "", url: "", formId: platform === "form" ? (forms[0]?.id ?? null) : null }]);

  return (
    <fieldset className="bs-links" data-testid="booster-links">
      <legend>Links ({links.length} of {MAX_BOOSTER_LINKS})</legend>
      {links.length === 0 && (
        <EmptyState icon="link" title="No links yet" testId="booster-links-empty">
          <p>Add the review sites you&apos;re on. Google is a good first one.</p>
        </EmptyState>
      )}
      <ol className="bs-link-list">
        {links.map((l, i) => (
          <li
            key={l.id}
            className="bs-link-row"
            data-testid="booster-link-row"
            data-dragging={dragging === i || undefined}
            data-over={over === i && dragging !== i ? true : undefined}
            onDragOver={(e) => {
              if (dragging === null) return;
              e.preventDefault();
              setOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging !== null) move(dragging, i);
              setDragging(null);
              setOver(null);
            }}
          >
            <div className="bs-link-head">
              <span
                className="bs-grip"
                draggable
                title="Drag to reorder"
                aria-hidden
                onDragStart={(e) => {
                  setDragging(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", l.id);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
              >
                <Icon name="grip" />
              </span>
              <Svg platform={l.platform} />
              <label className="bs-grow">
                <span className="visually-hidden">Site for link {i + 1}</span>
                <select
                  value={l.platform}
                  onChange={(e) => {
                    const platform = e.target.value as BoosterPlatform;
                    set(i, { platform, formId: platform === "form" ? (l.formId ?? forms[0]?.id ?? null) : null });
                  }}
                  data-testid="booster-link-platform"
                >
                  {BOOSTER_PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {PLATFORMS[p].name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="ghost small" aria-label={`Move link ${i + 1} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                ↑
              </button>
              <button type="button" className="ghost small" aria-label={`Move link ${i + 1} down`} disabled={i === links.length - 1} onClick={() => move(i, i + 1)}>
                ↓
              </button>
              <button type="button" className="ghost small" aria-label={`Remove link ${i + 1}`} onClick={() => onChange(links.filter((_, j) => j !== i))}>
                <Icon name="trash" />
              </button>
            </div>
            <label>
              Button text
              <input type="text" value={l.label} maxLength={60} placeholder={PLATFORMS[l.platform].label} onChange={(e) => set(i, { label: e.target.value })} data-testid="booster-link-label" />
            </label>
            {l.platform === "form" ? (
              <label>
                Form
                <select value={l.formId ?? ""} onChange={(e) => set(i, { formId: e.target.value || null })} data-testid="booster-link-form">
                  {forms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Link
                <input
                  type="url"
                  value={l.url}
                  maxLength={2000}
                  placeholder="https://…"
                  onChange={(e) => set(i, { url: e.target.value })}
                  data-testid="booster-link-url"
                />
              </label>
            )}
            {l.platform === "google" && <GoogleHelper placesSearch={placesSearch} onUrl={(url) => set(i, { url })} />}
          </li>
        ))}
      </ol>
      {links.length < MAX_BOOSTER_LINKS ? (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="secondary small" onClick={() => add(links.some((l) => l.platform === "google") ? "trustpilot" : "google")} data-testid="booster-add-link">
            <Icon name="plus" />
            Add a link
          </button>
          {forms.length > 0 && !links.some((l) => l.platform === "form") && (
            <button type="button" className="ghost small" onClick={() => add("form")}>
              Add your testimonial form
            </button>
          )}
        </div>
      ) : (
        <p className="muted xsmall">That&apos;s the most a page takes: {MAX_BOOSTER_LINKS} links.</p>
      )}
    </fieldset>
  );
}

type PlaceHit = { placeId: string; name: string; address: string; reviewUrl: string };

/** BOOST-02: a Maps link or Place ID becomes the review link; with a Places key, a business search too. */
function GoogleHelper({ placesSearch, onUrl }: { placesSearch: boolean; onUrl: (url: string) => void }) {
  const [paste, setPaste] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlaceHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <details className="bs-google" data-testid="google-helper">
      <summary className="small">Get your Google review link</summary>
      <div className="stack" style={{ gap: 8 }}>
        <form
          className="bs-inline"
          onSubmit={(e) => {
            e.preventDefault();
            const r = googleReviewLink(paste);
            if (r.ok) {
              onUrl(r.url);
              setProblem(null);
              setPaste("");
            } else setProblem(r.error);
          }}
        >
          <label className="bs-grow">
            Google Maps link or Place ID
            <input type="text" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="ChIJ… or https://www.google.com/maps/…" data-testid="google-paste" />
          </label>
          <button type="submit" className="secondary small" disabled={!paste.trim()}>
            Use it
          </button>
        </form>
        {problem && (
          <p className="error small" role="alert">
            {problem}
          </p>
        )}
        {placesSearch ? (
          <>
            <form
              className="bs-inline"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setProblem(null);
                try {
                  setHits((await api<{ places: PlaceHit[] }>("/api/admin/boosters/google-places", { method: "POST", json: { query } })).places);
                } catch (err) {
                  setProblem(errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="bs-grow">
                Or find the business
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Acme Bakery, Leeds" data-testid="google-search" />
              </label>
              <button type="submit" className="secondary small" disabled={busy || query.trim().length < 2}>
                {busy ? "Searching…" : "Search"}
              </button>
            </form>
            {hits && hits.length === 0 && <p className="muted small">Nothing found. Try the name and the town.</p>}
            {hits && hits.length > 0 && (
              <ul className="bs-hits" data-testid="google-hits">
                {hits.map((h) => (
                  <li key={h.placeId}>
                    <span>
                      <strong>{h.name}</strong> <span className="muted xsmall">{h.address}</span>
                    </span>
                    <button type="button" className="secondary small" onClick={() => onUrl(h.reviewUrl)}>
                      Use this
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="muted xsmall" data-testid="google-no-key">
            Business search needs a Google Places API key on this server (GOOGLE_PLACES_API_KEY), so here it&apos;s paste only.
            Copy the link from your business in Google Maps, or find the Place ID with Google&apos;s Place ID finder.
          </p>
        )}
      </div>
    </details>
  );
}

function LogoField({ booster, projectLogo, onBooster, onError }: { booster: AdminBooster; projectLogo: string | null; onBooster: (b: AdminBooster) => void; onError: (e: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const url = booster.logoUrl ?? projectLogo;
  async function run(init: Parameters<typeof api>[1]) {
    setBusy(true);
    onError(null);
    try {
      onBooster((await api<{ booster: AdminBooster }>(`/api/admin/boosters/${booster.id}/logo`, init)).booster);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="bs-image" data-testid="booster-logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" /> : <span className="bs-image-empty" aria-hidden><Icon name="image" /></span>}
      <div className="stack" style={{ gap: 4 }}>
        <span className="muted xsmall">{booster.logoUrl ? "This page's own logo." : projectLogo ? "Your project's logo. Upload one for this page only if it should differ." : "No logo yet: the page shows your project's initial."}</span>
        <div className="row" style={{ gap: 6 }}>
          <label className="button secondary small">
            <Icon name="upload" />
            {busy ? "Uploading…" : booster.logoUrl ? "Replace logo" : "Upload logo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="visually-hidden"
              aria-label="Logo image"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const body = new FormData();
                body.set("image", f);
                void run({ method: "POST", body });
              }}
            />
          </label>
          {booster.logoUrl && (
            <button type="button" className="secondary small" disabled={busy} onClick={() => run({ method: "DELETE" })}>
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Draft or public, the link (with a slug change that keeps old links working) and the QR code (BOOST-04). */
function ShareSection({
  booster,
  project,
  dirty,
  onPublished,
  onBooster,
  onError,
  onDone,
}: {
  booster: AdminBooster;
  project: Props["project"];
  dirty: boolean;
  onPublished: (p: boolean) => Promise<void>;
  onBooster: (b: AdminBooster) => void;
  onError: (e: string | null) => void;
  onDone: (m: string) => void;
}) {
  const [slug, setSlug] = useState(booster.slug);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSlug(booster.slug), [booster.slug]);
  return (
    <>
      <Toggle
        label="Public"
        hint={booster.published ? "Anyone with the link or QR code sees the page." : "A draft: the link shows “not found” until you make it public."}
        checked={booster.published}
        onChange={(p) => void onPublished(p)}
        testId="booster-public"
      />
      {dirty && <p className="muted xsmall">Making it public saves your changes too.</p>}
      <CopyField label="Page link" value={booster.url} testId="booster-link" />
      <form
        className="bs-inline"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          onError(null);
          try {
            const r = await api<{ booster: AdminBooster; droppedAlias: boolean }>(`/api/admin/boosters/${booster.id}/slug`, { method: "POST", json: { slug } });
            onBooster(r.booster);
            onDone(r.droppedAlias ? "Link changed. Another page's old link with this name no longer redirects." : "Link changed. The old link and printed QR codes still work.");
          } catch (err) {
            onError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="bs-grow">
          Address
          <span className="bs-slug-row">
            <span className="muted xsmall">/b/{project.slug}/</span>
            <input type="text" value={slug} maxLength={48} onChange={(e) => setSlug(e.target.value)} aria-label="Page address" data-testid="booster-slug" />
          </span>
        </label>
        <button type="submit" className="secondary small" disabled={busy || slug === booster.slug || !slug.trim()}>
          {busy ? "Changing…" : "Change"}
        </button>
      </form>
      <h3 className="section-title">QR code</h3>
      {!booster.published && <p className="notice small">The code works once the page is public.</p>}
      <QrStudio url={booster.url} fileBase={booster.slug} logoUrl={booster.logoUrl ?? project.logoUrl} suggestion={booster.design.button} />
    </>
  );
}

/** BOOST-05: daily clicks per link. Counts only, cookieless. */
function ClicksSection({ booster }: { booster: AdminBooster }) {
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const [stats, setStats] = useState<ClickStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setStats((await api<{ stats: ClickStats }>(`/api/admin/boosters/${booster.id}/clicks?days=${days}`)).stats);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [booster.id, days]);
  useEffect(() => {
    void load();
  }, [load]);
  const max = Math.max(1, ...(stats?.links.flatMap((l) => l.daily) ?? [1]));
  return (
    <div className="stack" data-testid="booster-clicks">
      <div className="row spread">
        <Segmented label="Period" options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} value={days} onChange={setDays} />
        <button type="button" className="ghost small" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!stats && !error && <p className="muted">Loading…</p>}
      {stats && stats.total === 0 && (
        <EmptyState icon="link" title="No clicks yet" testId="booster-clicks-empty">
          <p>{booster.published ? "Share the link or put the QR code where customers see it. Clicks show here by day." : "Make the page public, then share it. Clicks show here by day."}</p>
        </EmptyState>
      )}
      {stats && stats.total > 0 && (
        <>
          <p className="small">
            <strong data-testid="booster-clicks-total">{stats.total}</strong> click{stats.total === 1 ? "" : "s"} in the last {days} days
          </p>
          <table className="bs-clicks">
            <thead>
              <tr>
                <th scope="col">Link</th>
                <th scope="col">Clicks</th>
                <th scope="col">By day</th>
              </tr>
            </thead>
            <tbody>
              {stats.links.map((l) => (
                <tr key={l.id} data-testid="booster-clicks-row">
                  <td>{l.label}</td>
                  <td>
                    <strong>{l.total}</strong>
                  </td>
                  <td>
                    <span className="bs-bars" role="img" aria-label={`${l.total} clicks, by day from ${stats.days[0]} to ${stats.days.at(-1)}`}>
                      {l.daily.map((n, i) => (
                        <span key={i} style={{ height: `${Math.round((n / max) * 100)}%` }} title={`${stats.days[i]}: ${n}`} />
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted xsmall">Only a count per link and day is kept: no addresses, devices or cookies. Days are in UTC.</p>
        </>
      )}
    </div>
  );
}
