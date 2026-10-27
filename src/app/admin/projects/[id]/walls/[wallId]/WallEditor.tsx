"use client";

import "@/app/admin/walls.css";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { ColorField, DevicePreview, Segmented, Tabs, Toast, Toggle, UnsavedGuard, type Device } from "@/components/admin";
import { Icon } from "@/components/Icon";
import { inkFor, WallView } from "@/components/WallView";
import { SCHEMA_TYPE_LABELS, SEO_SCHEMA_TYPES } from "@/lib/seo";
import { accentStyle } from "@/lib/theme";
import {
  PAGINATION,
  THEME_LABELS,
  THEME_COLOURS,
  THEME_SWATCHES,
  WALL_THEMES,
  type WallConfig,
  type WallTheme,
} from "@/lib/wall-config";
import { DATE_MODES, FEED_TYPES, WIDGET_FONTS } from "@/lib/widget-config";
import type { AdminWall, WallViewData } from "@/lib/walls";

type Choice = { id: string; name: string };

type Props = {
  project: { id: string; slug: string; name: string; accentColor: string };
  initial: AdminWall;
  origin: string;
  tags: string[];
  forms: Choice[];
  featured: { id: string; label: string }[];
};

type Draft = {
  name: string;
  theme: WallTheme;
  featuredTestimonialId: string | null;
  connectedFormId: string | null;
  config: WallConfig;
};

type Section = "content" | "look" | "testimonials" | "seo" | "publish";

const draftOf = (w: AdminWall): Draft => ({
  name: w.name,
  theme: w.theme,
  featuredTestimonialId: w.featuredTestimonialId,
  connectedFormId: w.connectedFormId,
  config: w.config,
});

const DATE_LABELS: Record<(typeof DATE_MODES)[number], string> = { absolute: "Date", relative: "Time ago", hidden: "Hidden" };
const TYPE_LABELS: Record<(typeof FEED_TYPES)[number], string> = { any: "Any", text: "Text only", video: "Video only", image: "With images" };

/**
 * The wall editor (WALL-01..03): Content · Look · Testimonials · SEO ·
 * Publish on the left, and the live preview (the real WallView with the
 * unsaved config) at desktop or phone width on the right.
 */
export function WallEditor({ project, initial, origin, tags, forms, featured }: Props) {
  const [wall, setWall] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [saved, setSaved] = useState(() => JSON.stringify(draftOf(initial)));
  const [section, setSection] = useState<Section>("content");
  const [device, setDevice] = useState<Device>("desktop");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState<WallViewData | null>(null);
  const [previewTab, setPreviewTab] = useState(0);
  const dirty = JSON.stringify(draft) !== saved;
  const cfg = draft.config;
  // The colours as the page shows them (WallView's vars): yours, else the theme's; for the defaults and the contrast warnings.
  const theme = THEME_COLOURS[draft.theme];
  const heroBg = cfg.hero.background || theme.heroBg;
  const ctaBg = cfg.heroCta.background || theme.ctaBg || project.accentColor;
  const cardBg = cfg.card.background || theme.card;

  function sec<K extends keyof WallConfig>(key: K, patch: Partial<WallConfig[K]>) {
    setDraft((d) => ({ ...d, config: { ...d.config, [key]: { ...(d.config[key] as object), ...patch } } }));
  }
  const setCfg = (patch: Partial<WallConfig>) => setDraft((d) => ({ ...d, config: { ...d.config, ...patch } }));

  const previewBody = JSON.stringify({
    theme: draft.theme,
    config: draft.config,
    featuredTestimonialId: draft.featuredTestimonialId,
    connectedFormId: draft.connectedFormId,
    tab: previewTab,
    // Re-fetch after an image upload.
    v: `${wall.logoUrl}|${wall.coverUrl}`,
  });

  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const { v, ...body } = JSON.parse(previewBody);
        void v;
        const res = await api<{ view: WallViewData }>(`/api/admin/walls/${initial.id}/preview`, { method: "POST", json: body });
        if (live) setView(res.view);
      } catch {
        // A half-typed value fails validation; the last good preview stays.
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [previewBody, initial.id]);

  async function run<T>(fn: () => Promise<T>, done?: string): Promise<T | undefined> {
    setError(null);
    try {
      const r = await fn();
      if (done) setToast(done);
      return r;
    } catch (err) {
      setError(errorMessage(err));
      return undefined;
    }
  }

  async function save() {
    setSaving(true);
    await run(async () => {
      const { wall: next } = await api<{ wall: AdminWall }>(`/api/admin/walls/${wall.id}`, { method: "PATCH", json: draft });
      setWall(next);
      setDraft(draftOf(next));
      setSaved(JSON.stringify(draftOf(next)));
    }, "Saved");
    setSaving(false);
  }

  async function setPublished(published: boolean) {
    await run(async () => {
      const { wall: next } = await api<{ wall: AdminWall }>(`/api/admin/walls/${wall.id}`, { method: "PATCH", json: { published } });
      setWall(next);
    }, published ? "Published" : "Moved back to draft");
  }

  async function setMain(main: boolean) {
    await run(async () => {
      const { wall: next } = await api<{ wall: AdminWall }>(`/api/admin/walls/${wall.id}/main`, { method: "POST", json: { main } });
      setWall(next);
    }, main ? "This is now the main wall" : "No longer the main wall");
  }

  return (
    <div className="stack-lg" data-testid="wall-editor">
      <UnsavedGuard dirty={dirty} />
      <div className="page-head">
        <div>
          <h1>{draft.name}</h1>
          <p className="muted small">
            <span className="wl-badge" data-state={wall.published ? "published" : "draft"} data-testid="wall-status">
              {wall.published ? "Published" : "Draft"}
            </span>
            {wall.isMain && (
              <span className="wl-badge" data-state="main">
                Main
              </span>
            )}{" "}
            <code>{wall.publicUrl}</code>
          </p>
        </div>
        <div className="row" style={{ gap: "var(--space-2)" }}>
          {wall.published && (
            <a className="button secondary small" href={wall.publicUrl} target="_blank" rel="noreferrer">
              <Icon name="external" />
              View
            </a>
          )}
          <button type="button" className="accent" onClick={save} disabled={!dirty || saving} data-testid="save-wall">
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="wl-editor">
        <section className="wl-panel" aria-label="Wall settings">
          <Tabs
            label="Editor sections"
            value={section}
            onChange={(s) => setSection(s as Section)}
            tabs={[
              { id: "content", label: "Content" },
              { id: "look", label: "Look" },
              { id: "testimonials", label: "Testimonials" },
              { id: "seo", label: "SEO" },
              { id: "publish", label: "Publish" },
            ]}
          >
            <div className="wl-fields">
              {section === "content" && (
                <>
                  <label>
                    Wall name
                    <input type="text" value={draft.name} maxLength={120} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                  </label>
                  <fieldset>
                    <legend>Hero</legend>
                    <label>
                      Title
                      <input type="text" value={cfg.hero.title} maxLength={120} onChange={(e) => sec("hero", { title: e.target.value })} />
                    </label>
                    <label>
                      Subtitle
                      <textarea rows={2} value={cfg.hero.subtitle} maxLength={300} onChange={(e) => sec("hero", { subtitle: e.target.value })} />
                    </label>
                    <Segmented
                      label="Alignment"
                      options={[
                        { value: "center", label: "Centred" },
                        { value: "left", label: "Left" },
                      ]}
                      value={cfg.hero.align}
                      onChange={(align) => sec("hero", { align })}
                    />
                    <Toggle label="Show the total and average rating" checked={cfg.hero.showStats} onChange={(showStats) => sec("hero", { showStats })} />
                    <label>
                      Featured testimonial
                      <select
                        value={draft.featuredTestimonialId ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, featuredTestimonialId: e.target.value || null }))}
                      >
                        <option value="">None</option>
                        {featured.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="wl-pair">
                      <ColorField label="Hero background" value={cfg.hero.background} allowEmpty placeholder={theme.heroBg} onChange={(background) => sec("hero", { background })} />
                      <ColorField
                        label="Hero text"
                        value={cfg.hero.text}
                        allowEmpty
                        placeholder={inkFor("", cfg.hero.background) || theme.heroInk}
                        contrastWith={heroBg}
                        onChange={(text) => sec("hero", { text })}
                      />
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend>Hero button</legend>
                    <Toggle label="Show a button in the hero" checked={cfg.heroCta.enabled} onChange={(enabled) => sec("heroCta", { enabled })} />
                    <label>
                      Button text
                      <input type="text" value={cfg.heroCta.text} maxLength={40} onChange={(e) => sec("heroCta", { text: e.target.value })} />
                    </label>
                    <label>
                      Button link (blank opens your form)
                      <input type="url" value={cfg.heroCta.url} maxLength={500} placeholder="https://…" onChange={(e) => sec("heroCta", { url: e.target.value })} />
                    </label>
                    <label>
                      Form the buttons open
                      <select value={draft.connectedFormId ?? ""} onChange={(e) => setDraft((d) => ({ ...d, connectedFormId: e.target.value || null }))}>
                        <option value="">The default form</option>
                        {forms.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="wl-pair">
                      <ColorField
                        label="Button colour"
                        value={cfg.heroCta.background}
                        allowEmpty
                        placeholder={theme.ctaBg ?? project.accentColor}
                        onChange={(background) => sec("heroCta", { background })}
                      />
                      <ColorField
                        label="Button text colour"
                        value={cfg.heroCta.color}
                        allowEmpty
                        placeholder={inkFor("", cfg.heroCta.background) || theme.ctaInk || accentStyle(ctaBg)["--on-accent"]}
                        contrastWith={ctaBg}
                        onChange={(color) => sec("heroCta", { color })}
                      />
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend>Header</legend>
                    <ImageField label="Logo" kind="logo" wall={wall} onWall={setWall} onError={setError} />
                    <label>
                      Logo link (optional)
                      <input type="url" value={cfg.logoLink} maxLength={500} placeholder="https://example.com" onChange={(e) => setCfg({ logoLink: e.target.value })} />
                    </label>
                    <NavLinks nav={cfg.nav} onChange={(nav) => setCfg({ nav })} />
                  </fieldset>
                  <fieldset>
                    <legend>Cover image</legend>
                    <ImageField label="Cover" kind="cover" wall={wall} onWall={setWall} onError={setError} />
                    <p className="muted xsmall">Shown behind the hero. A PNG or JPEG cover is also used for link previews.</p>
                  </fieldset>
                </>
              )}

              {section === "look" && (
                <>
                  <fieldset>
                    <legend>Theme</legend>
                    <div className="wl-themes" role="radiogroup" aria-label="Theme">
                      {WALL_THEMES.map((t) => (
                        <button
                          key={t}
                          type="button"
                          role="radio"
                          aria-checked={draft.theme === t}
                          className="wl-theme"
                          data-testid={`theme-${t}`}
                          onClick={() => setDraft((d) => ({ ...d, theme: t }))}
                        >
                          <span className="wl-swatch" style={{ background: THEME_SWATCHES[t].bg }} aria-hidden>
                            <span style={{ background: THEME_SWATCHES[t].card, borderColor: THEME_SWATCHES[t].accent }} />
                          </span>
                          <strong>{THEME_LABELS[t].name}</strong>
                          <span className="muted xsmall">{THEME_LABELS[t].blurb}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <label>
                    Font
                    <select value={cfg.font} onChange={(e) => setCfg({ font: e.target.value as WallConfig["font"] })}>
                      {WIDGET_FONTS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset>
                    <legend>Cards</legend>
                    <div className="wl-pair">
                      <ColorField label="Card colour" value={cfg.card.background} allowEmpty placeholder={theme.card} onChange={(background) => sec("card", { background })} />
                      <ColorField
                        label="Card text"
                        value={cfg.card.text}
                        allowEmpty
                        placeholder={inkFor("", cfg.card.background) || theme.cardInk}
                        contrastWith={cardBg}
                        onChange={(text) => sec("card", { text })}
                      />
                      <ColorField label="Card border" value={cfg.card.border} allowEmpty onChange={(border) => sec("card", { border })} />
                    </div>
                    <label>
                      Corner radius ({cfg.card.radius}px)
                      <input type="range" min={0} max={32} value={cfg.card.radius} onChange={(e) => sec("card", { radius: Number(e.target.value) })} />
                    </label>
                    <Toggle label="Card shadow" checked={cfg.card.shadow} onChange={(shadow) => sec("card", { shadow })} />
                  </fieldset>
                  <fieldset>
                    <legend>Layout</legend>
                    <Segmented
                      label="Columns on a wide screen"
                      options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))}
                      value={String(cfg.layout.columns)}
                      onChange={(v) => sec("layout", { columns: Number(v) })}
                    />
                    <Segmented
                      label="More testimonials"
                      options={PAGINATION.map((p) => ({ value: p, label: p === "load_more" ? "“Load more” button" : "Infinite scroll" }))}
                      value={cfg.layout.pagination}
                      onChange={(pagination) => sec("layout", { pagination })}
                    />
                    <label>
                      Testimonials per page
                      <input
                        type="number"
                        min={3}
                        max={48}
                        value={cfg.layout.pageSize}
                        onChange={(e) => sec("layout", { pageSize: Math.max(3, Math.min(48, Number(e.target.value) || 12)) })}
                      />
                    </label>
                  </fieldset>
                  <fieldset>
                    <legend>On each card</legend>
                    {(
                      [
                        ["showRating", "Star rating"],
                        ["showVideo", "Video"],
                        ["showImages", "Images"],
                        ["showAvatar", "Photo"],
                        ["showTitle", "Job title and company"],
                        ["showHeadline", "Headline"],
                        ["showSource", "Link to the original review"],
                        ["showVerified", "“Verified” mark"],
                      ] as const
                    ).map(([k, label]) => (
                      <Toggle key={k} label={label} checked={cfg.display[k]} onChange={(v) => sec("display", { [k]: v })} />
                    ))}
                    <Segmented
                      label="Date"
                      options={DATE_MODES.map((m) => ({ value: m, label: DATE_LABELS[m] }))}
                      value={cfg.display.date}
                      onChange={(date) => sec("display", { date })}
                    />
                  </fieldset>
                </>
              )}

              {section === "testimonials" && (
                <>
                  <fieldset>
                    <legend>Which testimonials</legend>
                    <label>
                      Lowest rating
                      <select value={cfg.filters.minRating} onChange={(e) => sec("filters", { minRating: Number(e.target.value) })}>
                        <option value={0}>Any (unrated too)</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n} stars and up
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Type
                      <select value={cfg.filters.type} onChange={(e) => sec("filters", { type: e.target.value as WallConfig["filters"]["type"] })}>
                        {FEED_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Order
                      <select value={cfg.filters.sort} onChange={(e) => sec("filters", { sort: e.target.value as WallConfig["filters"]["sort"] })}>
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                        <option value="rating">Highest rated first</option>
                        <option value="manual">Inbox pins first</option>
                      </select>
                    </label>
                  </fieldset>
                  <fieldset>
                    <legend>Tabs</legend>
                    <Toggle
                      label="Show tabs that filter by tag"
                      checked={cfg.tabs.enabled}
                      onChange={(enabled) =>
                        sec("tabs", { enabled, items: enabled && !cfg.tabs.items.length ? [{ label: "All", tag: "" }] : cfg.tabs.items })
                      }
                      testId="tabs-enabled"
                    />
                    {cfg.tabs.enabled && (
                      <TabsEditor
                        tabs={cfg.tabs}
                        tags={tags}
                        onChange={(t) => {
                          sec("tabs", t);
                          setPreviewTab(0);
                        }}
                      />
                    )}
                  </fieldset>
                  <fieldset>
                    <legend>Call to action between cards</legend>
                    <Toggle label="Show a call to action between the cards" checked={cfg.inlineCta.enabled} onChange={(enabled) => sec("inlineCta", { enabled })} testId="inline-cta-enabled" />
                    {cfg.inlineCta.enabled && (
                      <>
                        <label>
                          After how many cards
                          <input
                            type="number"
                            min={1}
                            max={48}
                            value={cfg.inlineCta.after}
                            onChange={(e) => sec("inlineCta", { after: Math.max(1, Math.min(48, Number(e.target.value) || 6)) })}
                          />
                        </label>
                        <label>
                          Heading
                          <input type="text" value={cfg.inlineCta.title} maxLength={80} onChange={(e) => sec("inlineCta", { title: e.target.value })} />
                        </label>
                        <label>
                          Text (optional)
                          <input type="text" value={cfg.inlineCta.text} maxLength={200} onChange={(e) => sec("inlineCta", { text: e.target.value })} />
                        </label>
                        <label>
                          Button text
                          <input type="text" value={cfg.inlineCta.buttonText} maxLength={40} onChange={(e) => sec("inlineCta", { buttonText: e.target.value })} />
                        </label>
                        <label>
                          Button link (blank opens your form)
                          <input type="url" value={cfg.inlineCta.url} maxLength={500} placeholder="https://…" onChange={(e) => sec("inlineCta", { url: e.target.value })} />
                        </label>
                      </>
                    )}
                  </fieldset>
                </>
              )}

              {section === "seo" && (
                <>
                  <label>
                    Page title
                    <input
                      type="text"
                      value={cfg.seo.title}
                      maxLength={70}
                      placeholder={cfg.hero.title || draft.name}
                      onChange={(e) => sec("seo", { title: e.target.value })}
                    />
                  </label>
                  <label>
                    Meta description
                    <textarea
                      rows={3}
                      value={cfg.seo.description}
                      maxLength={200}
                      placeholder={cfg.hero.subtitle || `What people say about ${project.name}.`}
                      onChange={(e) => sec("seo", { description: e.target.value })}
                    />
                  </label>
                  <Toggle
                    label="Hide from search engines (noindex)"
                    checked={cfg.seo.noindex}
                    onChange={(noindex) => sec("seo", { noindex })}
                    hint="The page still works for anyone with the link."
                    testId="seo-noindex"
                  />
                  <label>
                    What the reviews are about
                    <select value={cfg.seo.schemaType} onChange={(e) => sec("seo", { schemaType: e.target.value as WallConfig["seo"]["schemaType"] })}>
                      {SEO_SCHEMA_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {SCHEMA_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Its name
                    <input type="text" value={cfg.seo.itemName} maxLength={120} placeholder={project.name} onChange={(e) => sec("seo", { itemName: e.target.value })} />
                  </label>
                  <p className="muted xsmall" data-testid="seo-canonical">
                    Canonical address: <code>{`${origin}${wall.publicUrl}`}</code>. The page includes review data (JSON-LD) for search engines, and
                    its link preview image is made from your title, rating and quotes.
                  </p>
                  <HeadSettings head={cfg.head} onChange={(patch) => sec("head", patch)} wall={wall} onWall={setWall} onError={setError} />
                </>
              )}

              {section === "publish" && (
                <>
                  <Segmented
                    label="Status"
                    options={[
                      { value: "draft", label: "Draft" },
                      { value: "published", label: "Published" },
                    ]}
                    value={wall.published ? "published" : "draft"}
                    onChange={(v) => setPublished(v === "published")}
                    testId="wall-publish"
                  />
                  <p className="muted xsmall">A draft is visible only here. Its link shows “not found” until you publish it.</p>
                  <Toggle
                    label={`Show at /wall/${project.slug}`}
                    checked={wall.isMain}
                    onChange={setMain}
                    hint="Makes this the main wall, in place of the classic page (only while it’s published)."
                    testId="wall-main"
                  />
                  <SlugField wall={wall} onWall={setWall} onError={setError} onDone={setToast} projectSlug={project.slug} />
                </>
              )}
            </div>
          </Tabs>
        </section>
        <section className="wl-preview" aria-label="Preview">
          {view && view.tabs.length > 1 && (
            <Segmented
              label="Preview tab"
              options={view.tabs.map((t, i) => ({ value: String(i), label: t.label }))}
              value={String(view.tab)}
              onChange={(v) => setPreviewTab(Number(v))}
            />
          )}
          <DevicePreview device={device} onDevice={setDevice} label="Wall preview" testId="wall-preview">
            {view ? <WallView data={view} preview /> : <p className="muted">Loading the preview…</p>}
          </DevicePreview>
          <p className="muted xsmall">The preview shows your unsaved changes. Save to update the page.</p>
        </section>
      </div>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

/**
 * WALL-07: favicon, an analytics provider and site-verification codes. Fixed
 * fields only; Plaudit writes the tags itself. Nothing loads from another
 * site until a provider is chosen, and then only that provider.
 */
function HeadSettings({
  head,
  onChange,
  wall,
  onWall,
  onError,
}: {
  head: WallConfig["head"];
  onChange: (patch: Partial<WallConfig["head"]>) => void;
  wall: AdminWall;
  onWall: (w: AdminWall) => void;
  onError: (e: string | null) => void;
}) {
  return (
    <>
      <fieldset data-testid="wall-head">
        <legend>Favicon</legend>
        <ImageField label="Favicon" kind="favicon" wall={wall} onWall={onWall} onError={onError} />
        <p className="muted xsmall">A PNG or ICO, under 512 KB. Without one, the project&rsquo;s logo is used.</p>
      </fieldset>
      <fieldset>
        <legend>Analytics</legend>
        <Segmented
          label="Provider"
          options={[
            { value: "none", label: "None" },
            { value: "plausible", label: "Plausible" },
            { value: "ga4", label: "Google Analytics 4" },
          ]}
          value={head.analytics}
          onChange={(analytics) => onChange({ analytics })}
          testId="wall-analytics-provider"
        />
        {head.analytics === "plausible" && (
          <label>
            Plausible site domain
            <input type="text" value={head.plausibleDomain} maxLength={253} placeholder="example.com" onChange={(e) => onChange({ plausibleDomain: e.target.value.trim().toLowerCase() })} data-testid="wall-plausible-domain" />
          </label>
        )}
        {head.analytics === "ga4" && (
          <label>
            Measurement ID
            <input type="text" value={head.ga4Id} maxLength={14} placeholder="G-ABC123DEF4" onChange={(e) => onChange({ ga4Id: e.target.value.trim().toUpperCase() })} data-testid="wall-ga4-id" />
          </label>
        )}
        {head.analytics !== "none" && (
          <p className="notice warn small" role="note" data-testid="wall-analytics-note">
            {head.analytics === "plausible" ? "Plausible" : "Google"} will see this wall&rsquo;s visitors: their address, browser and the pages they view. Only
            this wall loads its script; your other walls, forms and widgets don&rsquo;t. Mention it in your privacy notice
            {head.analytics === "ga4" ? ", and ask for consent where the law needs it (Google Analytics sets cookies)" : ""}. Plaudit&rsquo;s own counts are
            cookieless and need none of this.
          </p>
        )}
      </fieldset>
      <fieldset>
        <legend>Site verification</legend>
        <p className="muted xsmall">Paste only the code from the meta tag the service gives you (the content=&ldquo;…&rdquo; part).</p>
        <label>
          Google Search Console
          <input type="text" value={head.googleVerification} maxLength={120} onChange={(e) => onChange({ googleVerification: e.target.value.trim() })} data-testid="wall-verify-google" />
        </label>
        <label>
          Bing Webmaster Tools
          <input type="text" value={head.bingVerification} maxLength={120} onChange={(e) => onChange({ bingVerification: e.target.value.trim() })} />
        </label>
        <label>
          Facebook domain verification
          <input type="text" value={head.facebookVerification} maxLength={120} onChange={(e) => onChange({ facebookVerification: e.target.value.trim() })} />
        </label>
      </fieldset>
    </>
  );
}

function ImageField({
  label,
  kind,
  wall,
  onWall,
  onError,
}: {
  label: string;
  kind: "logo" | "cover" | "favicon";
  wall: AdminWall;
  onWall: (w: AdminWall) => void;
  onError: (e: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const url = kind === "logo" ? wall.logoUrl : kind === "favicon" ? wall.faviconUrl : wall.coverUrl;
  async function upload(file: File) {
    setBusy(true);
    onError(null);
    try {
      const body = new FormData();
      body.set("image", file);
      onWall((await api<{ wall: AdminWall }>(`/api/admin/walls/${wall.id}/image?kind=${kind}`, { method: "POST", body })).wall);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      onWall((await api<{ wall: AdminWall }>(`/api/admin/walls/${wall.id}/image?kind=${kind}`, { method: "DELETE" })).wall);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="wl-image" data-testid={`wall-${kind}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" /> : <span className="wl-image-empty" aria-hidden><Icon name="image" /></span>}
      <label className="button secondary small">
        <Icon name="upload" />
        {busy ? "Uploading…" : url ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
        <input
          type="file"
          accept={kind === "favicon" ? "image/png,image/x-icon,image/vnd.microsoft.icon,.ico" : "image/png,image/jpeg,image/webp,image/gif"}
          className="visually-hidden"
          aria-label={`${label} image`}
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) upload(f);
          }}
        />
      </label>
      {url && (
        <button type="button" className="secondary small" onClick={remove} disabled={busy}>
          Remove
        </button>
      )}
    </div>
  );
}

function NavLinks({ nav, onChange }: { nav: WallConfig["nav"]; onChange: (n: WallConfig["nav"]) => void }) {
  const set = (i: number, p: Partial<WallConfig["nav"][number]>) => onChange(nav.map((n, j) => (j === i ? { ...n, ...p } : n)));
  return (
    <div className="stack" data-testid="wall-nav">
      {nav.map((n, i) => (
        <div className="wl-row" key={i}>
          <label>
            Link {i + 1} label
            <input type="text" value={n.label} maxLength={30} onChange={(e) => set(i, { label: e.target.value })} />
          </label>
          <label>
            Address
            <input type="url" value={n.url} maxLength={500} placeholder="https://…" onChange={(e) => set(i, { url: e.target.value })} />
          </label>
          <button type="button" className="secondary small" aria-label={`Remove link ${i + 1}`} onClick={() => onChange(nav.filter((_, j) => j !== i))}>
            <Icon name="close" />
          </button>
        </div>
      ))}
      {nav.length < 4 && (
        <div>
          <button type="button" className="secondary small" onClick={() => onChange([...nav, { label: "", url: "" }])}>
            <Icon name="plus" />
            Add a header link
          </button>
        </div>
      )}
    </div>
  );
}

function TabsEditor({ tabs, tags, onChange }: { tabs: WallConfig["tabs"]; tags: string[]; onChange: (t: Partial<WallConfig["tabs"]>) => void }) {
  const items = tabs.items;
  const set = (i: number, p: Partial<(typeof items)[number]>) => onChange({ items: items.map((t, j) => (j === i ? { ...t, ...p } : t)) });
  return (
    <div className="stack" data-testid="wall-tabs-editor">
      {items.map((t, i) => (
        <div className="wl-row" key={i} data-testid="wall-tab-row">
          <label>
            Tab {i + 1} label
            <input type="text" value={t.label} maxLength={30} onChange={(e) => set(i, { label: e.target.value })} />
          </label>
          <label>
            Shows
            <select value={t.tag} onChange={(e) => set(i, { tag: e.target.value })}>
              <option value="">Everything</option>
              {tags.map((g) => (
                <option key={g} value={g}>
                  Tag: {g}
                </option>
              ))}
            </select>
          </label>
          <label className="wl-default">
            <input type="radio" name="default-tab" checked={tabs.defaultTab === i} onChange={() => onChange({ defaultTab: i })} />
            Default
          </label>
          <button
            type="button"
            className="secondary small"
            aria-label={`Remove tab ${i + 1}`}
            disabled={items.length <= 1}
            onClick={() => onChange({ items: items.filter((_, j) => j !== i), defaultTab: tabs.defaultTab >= i && tabs.defaultTab > 0 ? tabs.defaultTab - 1 : tabs.defaultTab })}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
      {items.length < 8 && (
        <div>
          <button type="button" className="secondary small" onClick={() => onChange({ items: [...items, { label: tags[0] ?? "New tab", tag: tags[0] ?? "" }] })}>
            <Icon name="plus" />
            Add a tab
          </button>
        </div>
      )}
    </div>
  );
}

function SlugField({
  wall,
  onWall,
  onError,
  onDone,
  projectSlug,
}: {
  wall: AdminWall;
  onWall: (w: AdminWall) => void;
  onError: (e: string | null) => void;
  onDone: (m: string) => void;
  projectSlug: string;
}) {
  const [slug, setSlug] = useState(wall.slug);
  const [busy, setBusy] = useState(false);
  async function change(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      const r = await api<{ wall: AdminWall; droppedAlias: boolean }>(`/api/admin/walls/${wall.id}/slug`, { method: "POST", json: { slug } });
      onWall(r.wall);
      setSlug(r.wall.slug);
      onDone(r.droppedAlias ? "Link changed. Another wall’s old link with this name no longer redirects." : "Link changed. The old link still works.");
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="wl-slug" onSubmit={change}>
      <label>
        Wall link
        <span className="wl-slug-row">
          <span className="muted">/wall/{projectSlug}/</span>
          <input type="text" value={slug} maxLength={48} onChange={(e) => setSlug(e.target.value)} aria-label="Wall link" />
        </span>
      </label>
      <button type="submit" className="secondary small" disabled={busy || slug === wall.slug || !slug.trim()}>
        {busy ? "Changing…" : "Change link"}
      </button>
    </form>
  );
}
