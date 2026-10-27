"use client";

import "@/app/admin/share.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, errorMessage } from "@/app/admin/api";
import { ColorField, EmptyState, Segmented, Toggle } from "@/components/admin";
import { Icon } from "@/components/Icon";
import {
  BACKGROUND_KINDS,
  brandDesign,
  defaultShareDesign,
  designSize,
  LOGO_POSITIONS,
  MAX_PIXELS,
  MAX_SIDE,
  MIN_SIDE,
  PATTERN_LABELS,
  PATTERNS,
  SHARE_FONTS,
  SHARE_TEMPLATES,
  shareDesignSchema,
  SIZE_PRESETS,
  templateInfo,
  type ShareDesign,
  type ShareFormat,
  type ShareOverride,
  type SizePresetId,
} from "@/lib/share/design";
import type { Brand } from "@/lib/validation";

export type StudioTestimonial = { id: string; name: string; status: string; rating: number | null; excerpt: string; pageUrl: string | null };
type Asset = { id: string; kind: "background" | "logo"; url: string; createdAt: string };
type SavedTemplate = { id: string; name: string; design: ShareDesign };

const BG_LABELS: Record<(typeof BACKGROUND_KINDS)[number], string> = { solid: "Solid", gradient: "Gradient", pattern: "Pattern", image: "Image", transparent: "None" };
const POSITION_LABELS: Record<(typeof LOGO_POSITIONS)[number], string> = {
  "top-left": "Top left",
  "top-center": "Top centre",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom centre",
  "bottom-right": "Bottom right",
};
const MAX_ITEMS = 6;
const PREVIEW_DELAY_MS = 350;

/** The filename the server suggested, else a fallback. */
function fileName(res: Response, fallback: string) {
  return /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallback;
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** POSTs JSON and returns the response, turning an error answer into an ApiError with the server's words. */
async function post(url: string, json: unknown): Promise<Response> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json), credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status}). Try again.`);
  }
  return res;
}

/** JPEG in this browser from the server's PNG, for servers without ffmpeg (the drawing itself is still the server's). */
async function pngToJpegHere(png: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(png);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bmp, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("This browser can't make a JPEG"))), "image/jpeg", 0.92));
}

/**
 * The image studio (SHARE-01..03): pick 1 to 6 testimonials, a template and
 * a size, change the colours, background and logo, and override the wording
 * for this image only. The preview is the server's own render, so what you
 * see is what downloads. Export as PNG, JPEG or a ZIP, copy it, or share it.
 */
export function Studio({
  project,
  testimonials,
  initialIds,
  fonts,
  initialTemplates,
  initialAssets,
  wallUrl,
}: {
  project: { id: string; name: string; accentColor: string; logoUrl: string | null; brand: Brand };
  testimonials: StudioTestimonial[];
  initialIds: string[];
  fonts: string[];
  initialTemplates: SavedTemplate[];
  initialAssets: Asset[];
  wallUrl: string;
}) {
  const [design, setDesign] = useState<ShareDesign>(() =>
    shareDesignSchema.parse({ template: initialIds.length > 3 ? "grid" : initialIds.length > 1 ? "trio" : "spotlight" }),
  );
  const [items, setItems] = useState<ShareOverride[]>(() => initialIds.map((id) => ({ id })));
  const [format, setFormat] = useState<ShareFormat>("png");
  const [preview, setPreview] = useState<{ url: string; blob: Blob } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState(initialTemplates);
  const [assets, setAssets] = useState(initialAssets);
  const [templateName, setTemplateName] = useState("");
  const [search, setSearch] = useState("");
  const [zipSizes, setZipSizes] = useState<string[]>(["square", "portrait", "story"]);
  const seq = useRef(0);

  const byId = useMemo(() => new Map(testimonials.map((t) => [t.id, t])), [testimonials]);
  const info = templateInfo(design.template);
  const shown = items.slice(0, info.max);
  const set = (patch: Partial<ShareDesign>) => setDesign((d) => ({ ...d, ...patch }));
  const setBg = (patch: Partial<ShareDesign["background"]>) => setDesign((d) => ({ ...d, background: { ...d.background, ...patch } }));
  const setLogo = (patch: Partial<ShareDesign["logo"]>) => setDesign((d) => ({ ...d, logo: { ...d.logo, ...patch } }));
  const setSize = (patch: Partial<ShareDesign["size"]>) => setDesign((d) => ({ ...d, size: { ...d.size, ...patch } }));
  const size = designSize(design);
  const customTooBig = design.size.preset === "custom" && design.size.width * design.size.height > MAX_PIXELS;

  // The preview: the server's own render, a moment after the last change.
  const spec = useMemo(() => JSON.stringify({ design, items: shown }), [design, shown]);
  useEffect(() => {
    if (!shown.length || customTooBig) return;
    const n = ++seq.current;
    const timer = setTimeout(async () => {
      setRendering(true);
      try {
        const res = await post(`/api/admin/projects/${project.id}/share/render`, { ...JSON.parse(spec), format: "png" });
        const blob = await res.blob();
        if (n !== seq.current) return;
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { url: URL.createObjectURL(blob), blob };
        });
        setError(null);
      } catch (e) {
        if (n === seq.current) setError(errorMessage(e));
      } finally {
        if (n === seq.current) setRendering(false);
      }
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [spec, project.id, shown.length, customTooBig]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const message = await fn();
      if (message) setStatus(message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  /** One image in the chosen format; JPEG falls back to this browser when the server has no ffmpeg. */
  const render = useCallback(
    async (fmt: ShareFormat): Promise<{ blob: Blob; name: string }> => {
      const body = { design, items: shown, format: fmt, download: true };
      try {
        const res = await post(`/api/admin/projects/${project.id}/share/render`, body);
        return { blob: await res.blob(), name: fileName(res, `testimonial.${fmt === "jpeg" ? "jpg" : "png"}`) };
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 501 && fmt === "jpeg")) throw e;
        const res = await post(`/api/admin/projects/${project.id}/share/render`, { ...body, format: "png" });
        return { blob: await pngToJpegHere(await res.blob()), name: fileName(res, "testimonial.png").replace(/\.png$/, ".jpg") };
      }
    },
    [design, shown, project.id],
  );

  const download = () => run(async () => {
    const { blob, name } = await render(format);
    save(blob, name);
    return `Downloaded ${name}.`;
  });

  const copy = () =>
    run(async () => {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("This browser can't copy images. Download it instead.");
      // The promise goes straight into the ClipboardItem, so Safari still counts this as the click's own copy.
      const png = post(`/api/admin/projects/${project.id}/share/render`, { design, items: shown, format: "png" }).then((r) => r.blob());
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      return "Copied. Paste it into a post or a document.";
    });

  const zip = (renders: { design: ShareDesign; items: ShareOverride[] }[], label: string) =>
    run(async () => {
      const res = await post(`/api/admin/projects/${project.id}/share/zip`, { renders, format });
      save(await res.blob(), fileName(res, "testimonial-images.zip"));
      return `Downloaded ${label}.`;
    });

  const zipSizesNow = () =>
    zip(
      SIZE_PRESETS.filter((p) => zipSizes.includes(p.id)).map((p) => ({ design: { ...design, size: { ...design.size, preset: p.id } }, items: shown })),
      `${zipSizes.length} sizes as a ZIP`,
    );
  const zipEach = () =>
    zip(
      items.map((it) => ({ design: { ...design, template: info.max === 1 ? design.template : "spotlight" }, items: [it] })),
      `${items.length} images as a ZIP`,
    );

  /** SHARE-03: saves the preview, then opens the platform's own "post this" page with the link (no SDK, no keys). */
  const shareTo = (platform: "x" | "linkedin") => {
    if (!preview) return;
    const first = byId.get(shown[0]?.id ?? "");
    const link = first?.pageUrl ?? wallUrl;
    const words = (shown[0]?.text?.replace(/\*\*/g, "") || first?.excerpt || "").trim();
    const text = words ? `“${words.length > 180 ? `${words.slice(0, 179)}…` : words}” — ${shown[0]?.name || first?.name}` : `What people say about ${project.name}`;
    save(preview.blob, `${design.template}-${size.width}x${size.height}.png`);
    const url =
      platform === "x"
        ? `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`
        : `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setStatus(`The image is downloaded. Attach it to the post that just opened${platform === "linkedin" ? " (LinkedIn adds the link; paste your words yourself)" : ""}.`);
  };

  const applyBrand = () => {
    const b = brandDesign(project.brand, { hasLogo: Boolean(project.logoUrl), fonts });
    setDesign((d) => ({ ...d, ...b, background: { ...d.background, ...b.background }, logo: { ...d.logo, ...b.logo } }));
    setStatus("Brand kit applied: colours, font and logo.");
  };

  const saveTemplate = () =>
    run(async () => {
      const { template } = await api<{ template: SavedTemplate }>(`/api/admin/projects/${project.id}/share/templates`, {
        method: "POST",
        json: { name: templateName.trim() || "My template", design },
      });
      setTemplates((ts) => [...ts, template].sort((a, b) => a.name.localeCompare(b.name)));
      setTemplateName("");
      return `Saved “${template.name}”. It keeps the look, not the testimonials.`;
    });

  const removeTemplate = (t: SavedTemplate) =>
    run(async () => {
      await api(`/api/admin/share-templates/${t.id}`, { method: "DELETE" });
      setTemplates((ts) => ts.filter((x) => x.id !== t.id));
    });

  const upload = (kind: Asset["kind"], file: File) =>
    run(async () => {
      const body = new FormData();
      body.set("file", file);
      body.set("kind", kind);
      const { asset } = await api<{ asset: Asset }>(`/api/admin/projects/${project.id}/share/assets`, { method: "POST", body });
      setAssets((a) => [asset, ...a]);
      if (kind === "background") setBg({ kind: "image", assetId: asset.id });
      else setLogo({ source: "upload", assetId: asset.id });
    });

  const removeAsset = (a: Asset) =>
    run(async () => {
      await api(`/api/admin/share-assets/${a.id}`, { method: "DELETE" });
      setAssets((list) => list.filter((x) => x.id !== a.id));
      setDesign((d) => ({
        ...d,
        background: d.background.assetId === a.id ? { ...d.background, assetId: "", kind: "solid" } : d.background,
        logo: d.logo.assetId === a.id ? { ...d.logo, assetId: "", source: "none" } : d.logo,
      }));
    });

  const toggle = (id: string) =>
    setItems((list) => (list.some((i) => i.id === id) ? list.filter((i) => i.id !== id) : list.length >= MAX_ITEMS ? list : [...list, { id }]));
  const override = (id: string, patch: Partial<ShareOverride>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const q = search.trim().toLowerCase();
  const filtered = testimonials.filter((t) => !q || t.name.toLowerCase().includes(q) || t.excerpt.toLowerCase().includes(q)).slice(0, 60);
  const bgs = assets.filter((a) => a.kind === "background");
  const logos = assets.filter((a) => a.kind === "logo");

  if (!testimonials.length) {
    return (
      <EmptyState icon="image" title="No testimonials to make images from yet" testId="studio-empty">
        Collect or add a testimonial first; then come back to turn it into an image for social posts, slides or emails.
      </EmptyState>
    );
  }

  return (
    <div className="sh-studio" data-testid="image-studio">
      <div className="page-head">
        <div>
          <h1>Image studio</h1>
          <p className="muted small">Turn testimonials into images for social posts, slides and emails. Changes here never alter the testimonials themselves.</p>
        </div>
      </div>
      <div className="sh-layout">
        <div className="sh-controls stack">
          <section className="sh-panel stack" aria-labelledby="sh-pick">
            <h2 id="sh-pick" className="sh-title">
              Testimonials <span className="muted xsmall">{`${items.length} of ${MAX_ITEMS} chosen`}</span>
            </h2>
            <input type="search" placeholder="Search by name or words" aria-label="Search testimonials" value={search} onChange={(e) => setSearch(e.target.value)} />
            <ul className="sh-pick-list" data-testid="studio-picker">
              {filtered.map((t) => {
                const on = items.some((i) => i.id === t.id);
                return (
                  <li key={t.id}>
                    <label className="sh-pick">
                      <input type="checkbox" checked={on} disabled={!on && items.length >= MAX_ITEMS} onChange={() => toggle(t.id)} data-testid="studio-pick" />
                      <span>
                        <strong className="small">{t.name}</strong> <span className={`badge ${t.status}`}>{t.status}</span>
                        <span className="muted xsmall sh-excerpt">{t.excerpt}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {items.length > info.max && (
              <p className="notice warn small" role="status">
                {`“${info.name}” shows ${info.max === 1 ? "one testimonial" : `up to ${info.max}`}; the first ${info.max === 1 ? "is" : info.max + " are"} used. Pick a template for more.`}
              </p>
            )}
          </section>

          {shown.length > 0 && (
            <section className="sh-panel stack" aria-labelledby="sh-words">
              <h2 id="sh-words" className="sh-title">
                Wording <span className="muted xsmall">(this image only)</span>
              </h2>
              {shown.map((it, i) => {
                const t = byId.get(it.id);
                return (
                  <fieldset key={it.id} className="sh-override stack" data-testid="studio-override">
                    <legend className="small">{`${i + 1}. ${t?.name ?? "Testimonial"}`}</legend>
                    <label>
                      Text
                      <textarea
                        rows={3}
                        maxLength={1200}
                        placeholder={t?.excerpt || "The testimonial's own words"}
                        value={it.text ?? ""}
                        onChange={(e) => override(it.id, { text: e.target.value || undefined })}
                        data-testid="override-text"
                      />
                    </label>
                    <div className="sh-pair">
                      <label>
                        Name
                        <input value={it.name ?? ""} placeholder={t?.name} maxLength={120} onChange={(e) => override(it.id, { name: e.target.value || undefined })} />
                      </label>
                      <label>
                        Title and company
                        <input value={it.byline ?? ""} placeholder="As saved" maxLength={160} onChange={(e) => override(it.id, { byline: e.target.value || undefined })} />
                      </label>
                    </div>
                  </fieldset>
                );
              })}
              <p className="muted xsmall">Leave a field empty to use what the testimonial says. Wrap words in **double stars** to highlight them; otherwise the testimonial&rsquo;s own highlights are used.</p>
            </section>
          )}

          <section className="sh-panel stack" aria-labelledby="sh-template">
            <h2 id="sh-template" className="sh-title">
              Template
            </h2>
            <div className="sh-templates" role="radiogroup" aria-labelledby="sh-template">
              {SHARE_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={design.template === t.id}
                  className="sh-template"
                  data-template={t.id}
                  onClick={() => set({ template: t.id })}
                  title={t.blurb}
                >
                  <span className={`sh-thumb sh-thumb-${t.id}`} aria-hidden="true" />
                  <span className="small">{t.name}</span>
                  <span className="muted xsmall">{t.max === 1 ? "1 testimonial" : `up to ${t.max}`}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="sh-panel stack" aria-labelledby="sh-size">
            <h2 id="sh-size" className="sh-title">
              Size
            </h2>
            <label>
              Preset
              <select value={design.size.preset} onChange={(e) => setSize({ preset: e.target.value as SizePresetId })} data-testid="studio-size">
                {SIZE_PRESETS.map((s) => (
                  <option key={s.id} value={s.id}>{`${s.label} (${s.width} × ${s.height})`}</option>
                ))}
                <option value="custom">Custom size</option>
              </select>
            </label>
            {design.size.preset === "custom" && (
              <div className="sh-pair">
                <label>
                  Width (px)
                  <input type="number" min={MIN_SIDE} max={MAX_SIDE} value={design.size.width} onChange={(e) => setSize({ width: Math.round(Number(e.target.value) || MIN_SIDE) })} data-testid="studio-width" />
                </label>
                <label>
                  Height (px)
                  <input type="number" min={MIN_SIDE} max={MAX_SIDE} value={design.size.height} onChange={(e) => setSize({ height: Math.round(Number(e.target.value) || MIN_SIDE) })} data-testid="studio-height" />
                </label>
              </div>
            )}
            {customTooBig && (
              <p className="error small" role="alert">
                That&rsquo;s more than 2048 × 2048 pixels. Make it smaller.
              </p>
            )}
          </section>

          <section className="sh-panel stack" aria-labelledby="sh-look">
            <h2 id="sh-look" className="sh-title">
              Look
            </h2>
            <div className="row sh-row">
              <button type="button" className="secondary small" onClick={applyBrand} data-testid="studio-brand">
                <Icon name="palette" />
                Use the brand kit
              </button>
            </div>
            <Segmented label="Theme" options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} value={design.theme} onChange={(theme) => set({ theme })} />
            <ColorField label="Accent" value={design.accent} allowEmpty placeholder={project.accentColor} onChange={(accent) => set({ accent })} hint="Quote marks, bars and panels. Empty uses the project colour." />
            <ColorField label="Highlight" value={design.highlight} onChange={(highlight) => set({ highlight: highlight || "#ffe066" })} testId="studio-highlight" />
            <ColorField label="Text" value={design.text} allowEmpty onChange={(text) => set({ text })} hint="Empty picks ink or white, whichever reads better." />
            {fonts.length > 1 && (
              <label>
                Font
                <select value={design.font} onChange={(e) => set({ font: e.target.value as ShareDesign["font"] })}>
                  {SHARE_FONTS.filter((f) => fonts.includes(f.id)).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Toggle label="Show the rating" checked={design.showRating} onChange={(showRating) => set({ showRating })} />
            <Toggle label="Show photos" checked={design.showAvatar} onChange={(showAvatar) => set({ showAvatar })} />
            <Toggle label="Show title and company" checked={design.showTitle} onChange={(showTitle) => set({ showTitle })} />
          </section>

          <section className="sh-panel stack" aria-labelledby="sh-bg">
            <h2 id="sh-bg" className="sh-title">
              Background
            </h2>
            <Segmented label="Background" options={BACKGROUND_KINDS.map((k) => ({ value: k, label: BG_LABELS[k] }))} value={design.background.kind} onChange={(kind) => setBg({ kind })} testId="studio-bg" />
            {design.background.kind !== "transparent" && design.background.kind !== "image" && (
              <ColorField label={design.background.kind === "gradient" ? "From" : "Colour"} value={design.background.color} allowEmpty onChange={(color) => setBg({ color })} hint="Empty uses the theme's." />
            )}
            {design.background.kind === "gradient" && (
              <>
                <ColorField label="To" value={design.background.color2} allowEmpty onChange={(color2) => setBg({ color2 })} hint="Empty uses the accent." />
                <label>
                  Angle <output>{`${design.background.angle}°`}</output>
                  <input type="range" min={0} max={360} step={15} value={design.background.angle} onChange={(e) => setBg({ angle: Number(e.target.value) })} />
                </label>
              </>
            )}
            {design.background.kind === "pattern" && (
              <label>
                Pattern
                <select value={design.background.pattern} onChange={(e) => setBg({ pattern: e.target.value as ShareDesign["background"]["pattern"] })} data-testid="studio-pattern">
                  {PATTERNS.map((p) => (
                    <option key={p} value={p}>
                      {PATTERN_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {design.background.kind === "image" && (
              <>
                <AssetPicker assets={bgs} selected={design.background.assetId} onPick={(assetId) => setBg({ assetId })} onRemove={removeAsset} label="Backgrounds" />
                <UploadButton label="Upload a background" onFile={(f) => void upload("background", f)} testId="studio-bg-upload" />
                <label>
                  Darken <output>{`${design.background.dim}%`}</output>
                  <input type="range" min={0} max={80} step={5} value={design.background.dim} onChange={(e) => setBg({ dim: Number(e.target.value) })} />
                </label>
              </>
            )}
            {design.background.kind === "transparent" && <p className="muted xsmall">PNG only: a JPEG can&rsquo;t be see-through, so it gets the theme&rsquo;s background.</p>}
          </section>

          <section className="sh-panel stack" aria-labelledby="sh-logo">
            <h2 id="sh-logo" className="sh-title">
              Logo
            </h2>
            <Segmented
              label="Logo"
              options={[
                { value: "none", label: "None" },
                { value: "brand", label: "Project logo", disabled: !project.logoUrl },
                { value: "upload", label: "Upload" },
              ]}
              value={design.logo.source}
              onChange={(source) => setLogo({ source })}
              testId="studio-logo"
            />
            {!project.logoUrl && <p className="muted xsmall">Add a project logo in Project settings to use it here.</p>}
            {design.logo.source === "upload" && (
              <>
                <AssetPicker assets={logos} selected={design.logo.assetId} onPick={(assetId) => setLogo({ assetId })} onRemove={removeAsset} label="Logos" />
                <UploadButton label="Upload a logo" onFile={(f) => void upload("logo", f)} testId="studio-logo-upload" />
              </>
            )}
            {design.logo.source !== "none" && (
              <div className="sh-pair">
                <label>
                  Position
                  <select value={design.logo.position} onChange={(e) => setLogo({ position: e.target.value as ShareDesign["logo"]["position"] })}>
                    {LOGO_POSITIONS.map((p) => (
                      <option key={p} value={p}>
                        {POSITION_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Size <output>{`${design.logo.size} px`}</output>
                  <input type="range" min={16} max={320} step={4} value={design.logo.size} onChange={(e) => setLogo({ size: Number(e.target.value) })} />
                </label>
              </div>
            )}
            <p className="muted xsmall">PNG or JPEG images.</p>
          </section>

          <section className="sh-panel stack" aria-labelledby="sh-mine">
            <h2 id="sh-mine" className="sh-title">
              My templates
            </h2>
            {templates.length === 0 ? (
              <p className="muted small">Save this look to use it again with other testimonials.</p>
            ) : (
              <ul className="sh-saved" data-testid="studio-templates">
                {templates.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="ghost small" onClick={() => setDesign(shareDesignSchema.parse(t.design))} data-testid="studio-template-apply">
                      {t.name}
                    </button>
                    <button type="button" className="ghost small" aria-label={`Delete ${t.name}`} onClick={() => void removeTemplate(t)}>
                      <Icon name="trash" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="row sh-row">
              <input value={templateName} maxLength={80} placeholder="Template name" aria-label="Template name" onChange={(e) => setTemplateName(e.target.value)} data-testid="studio-template-name" />
              <button type="button" className="secondary small" disabled={busy} onClick={() => void saveTemplate()} data-testid="studio-template-save">
                Save as my template
              </button>
            </div>
            <button type="button" className="ghost small" onClick={() => setDesign(defaultShareDesign())}>
              Start again from the defaults
            </button>
          </section>
        </div>

        <div className="sh-side stack">
          <section className="sh-preview" aria-label="Preview">
            {shown.length === 0 ? (
              <p className="muted small sh-preview-empty" data-testid="studio-no-pick">
                Choose a testimonial on the left to see the image.
              </p>
            ) : preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt="Preview of the image" data-testid="studio-preview" data-width={size.width} data-height={size.height} style={{ aspectRatio: `${size.width} / ${size.height}` }} />
            ) : (
              <p className="muted small sh-preview-empty">Drawing…</p>
            )}
            <p className="muted xsmall" aria-live="polite">
              {rendering ? "Drawing…" : `${size.width} × ${size.height} px`}
            </p>
          </section>
          {error && (
            <p className="error small" role="alert" data-testid="studio-error">
              {error}
            </p>
          )}
          {status && (
            <p className="notice small" role="status" data-testid="studio-status">
              {status}
            </p>
          )}
          <section className="sh-panel stack" aria-labelledby="sh-export">
            <h2 id="sh-export" className="sh-title">
              Export
            </h2>
            <Segmented label="Format" options={[{ value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG" }]} value={format} onChange={setFormat} testId="studio-format" />
            <div className="row sh-row">
              <button type="button" disabled={busy || !shown.length || customTooBig} onClick={() => void download()} data-testid="studio-download">
                <Icon name="download" />
                Download
              </button>
              <button type="button" className="secondary" disabled={busy || !shown.length || customTooBig} onClick={() => void copy()} data-testid="studio-copy">
                <Icon name="copy" />
                Copy image
              </button>
            </div>
            <fieldset className="sh-zip">
              <legend className="small">Several sizes in one ZIP</legend>
              <div className="sh-zip-sizes">
                {SIZE_PRESETS.map((p) => (
                  <label key={p.id} className="sh-check xsmall">
                    <input
                      type="checkbox"
                      checked={zipSizes.includes(p.id)}
                      onChange={(e) => setZipSizes((z) => (e.target.checked ? [...z, p.id] : z.filter((x) => x !== p.id)))}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
              <button type="button" className="secondary small" disabled={busy || !shown.length || !zipSizes.length} onClick={() => void zipSizesNow()} data-testid="studio-zip-sizes">
                Download sizes as ZIP
              </button>
            </fieldset>
            {items.length > 1 && (
              <button type="button" className="secondary small" disabled={busy} onClick={() => void zipEach()} data-testid="studio-zip-each">
                One image per testimonial (ZIP)
              </button>
            )}
          </section>
          <section className="sh-panel stack" aria-labelledby="sh-share">
            <h2 id="sh-share" className="sh-title">
              Share
            </h2>
            <p className="muted xsmall">Downloads the image and opens the site&rsquo;s own post page with a link to the testimonial. Nothing is sent to X or LinkedIn by Plaudit.</p>
            <div className="row sh-row">
              <button type="button" className="secondary small" disabled={!preview || rendering} onClick={() => shareTo("x")} data-testid="studio-share-x">
                Share to X
              </button>
              <button type="button" className="secondary small" disabled={!preview || rendering} onClick={() => shareTo("linkedin")} data-testid="studio-share-linkedin">
                Share to LinkedIn
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function UploadButton({ label, onFile, testId }: { label: string; onFile: (f: File) => void; testId: string }) {
  return (
    <label className="button secondary small sh-upload">
      <Icon name="upload" />
      {label}
      <input
        type="file"
        accept="image/png,image/jpeg"
        className="visually-hidden"
        data-testid={testId}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

function AssetPicker({ assets, selected, onPick, onRemove, label }: { assets: Asset[]; selected: string; onPick: (id: string) => void; onRemove: (a: Asset) => void; label: string }) {
  if (!assets.length) return null;
  return (
    <ul className="sh-assets" aria-label={label}>
      {assets.map((a) => (
        <li key={a.id}>
          <button type="button" className="sh-asset" aria-pressed={selected === a.id} onClick={() => onPick(a.id)} aria-label="Use this image">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt="" width={56} height={56} />
          </button>
          <button type="button" className="ghost small" aria-label="Delete this image" onClick={() => onRemove(a)}>
            <Icon name="close" />
          </button>
        </li>
      ))}
    </ul>
  );
}
