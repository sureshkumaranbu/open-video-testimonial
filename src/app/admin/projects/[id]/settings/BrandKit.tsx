"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { ColorField, FontField, fontFamilyOf, readableOn, type FontChoice } from "@/components/admin";
import { Icon } from "@/components/Icon";
import type { Brand } from "@/lib/validation";
import "@/app/admin/project-settings.css";

type ColorKey = keyof Brand["colors"];
type Colors = Record<ColorKey, string>;
type Fonts = { heading: string; body: string };

/**
 * Font stacks every device already has, so the kit needs no font files.
 * The self-hosted choices arrive with the form builder (FONT_CHOICES, WP2.2);
 * "" means the default.
 */
const FONTS: readonly FontChoice[] = [
  { id: "", label: "Default", family: "var(--font-ui)" },
  { id: "sans", label: "Sans serif", family: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { id: "serif", label: "Serif", family: "ui-serif, Georgia, 'Times New Roman', serif" },
  { id: "rounded", label: "Rounded", family: "ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', system-ui, sans-serif" },
  { id: "mono", label: "Monospace", family: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
];

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

function colorsOf(brand: Brand): Colors {
  const c = brand.colors;
  return {
    primary: c.primary ?? "",
    background: c.background ?? "",
    text: c.text ?? "",
    button: c.button ?? "",
    buttonText: c.buttonText ?? "",
    star: c.star ?? "",
  };
}
const fontsOf = (brand: Brand): Fonts => ({ heading: brand.fonts.heading ?? "", body: brand.fonts.body ?? "" });

/** The brand as stored: empty colours and fonts are left out, so they keep following the defaults. */
function toBrand(colors: Colors, fonts: Fonts): Brand {
  const keep = <T extends Record<string, string>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v)) as Partial<T>;
  return { colors: keep(colors), fonts: keep(fonts) };
}

const familyOf = (id: string) => fontFamilyOf(FONTS.find((f) => f.id === id) ?? FONTS[0]);

/**
 * The brand kit: a logo, colours and fonts that new forms, widgets and walls
 * start with. Changing it later doesn't restyle what's already made. The logo
 * uploads as soon as it's picked; colours and fonts save with the button.
 */
export function BrandKit({
  projectId,
  logoKey,
  accentColor,
  brand,
  onDirty,
  onLogo,
  onSaved,
}: {
  projectId: string;
  logoKey: string | null;
  accentColor: string;
  brand: Brand;
  onDirty: (dirty: boolean) => void;
  onLogo: (logoKey: string | null, message: string) => void;
  onSaved: (message: string) => void;
}) {
  const [saved, setSaved] = useState(() => ({ colors: colorsOf(brand), fonts: fontsOf(brand) }));
  const [colors, setColors] = useState(saved.colors);
  const [fonts, setFonts] = useState(saved.fonts);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState<"upload" | "remove" | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const dirty = JSON.stringify({ colors, fonts }) !== JSON.stringify(saved);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  // What each colour falls back to while it's empty, as the preview shows it.
  const primary = colors.primary || accentColor;
  const background = colors.background || "#ffffff";
  const text = colors.text || "#161b2e";
  const button = colors.button || primary;
  const buttonText = colors.buttonText || readableOn(button);
  const star = colors.star || "#f2a93b";
  const set = (key: ColorKey) => (hex: string) => setColors((c) => ({ ...c, [key]: hex }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/admin/projects/${projectId}`, { method: "PATCH", json: { brand: toBrand(colors, fonts) } });
      setSaved({ colors, fonts });
      onSaved("Brand kit saved");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function upload(picked: File | undefined) {
    if (!picked) return;
    setLogoBusy("upload");
    setLogoError(null);
    try {
      const body = new FormData();
      body.set("logo", picked);
      const { project } = await api<{ project: { logoKey: string | null } }>(`/api/admin/projects/${projectId}/logo`, { method: "POST", body });
      onLogo(project.logoKey, "Logo uploaded");
    } catch (err) {
      setLogoError(errorMessage(err));
    } finally {
      setLogoBusy(null);
      if (file.current) file.current.value = "";
    }
  }

  async function removeLogo() {
    setLogoBusy("remove");
    setLogoError(null);
    try {
      await api(`/api/admin/projects/${projectId}/logo`, { method: "DELETE" });
      onLogo(null, "Logo removed");
    } catch (err) {
      setLogoError(errorMessage(err));
    } finally {
      setLogoBusy(null);
    }
  }

  const preview = { background, color: text } as CSSProperties;
  return (
    <section className="panel" aria-labelledby="ps-brand-h" data-testid="brand-kit">
      <div className="panel-head">
        <h2 id="ps-brand-h" className="ps-title">
          <Icon name="palette" />
          Brand kit
        </h2>
      </div>
      <div className="panel-body stack-lg">
        <p className="muted small">New forms, widgets and walls start with these. Changing them later leaves what you&apos;ve already made as it is.</p>

        <div className="stack">
          <h3 className="ps-subtitle">Logo</h3>
          <div className="ps-logo">
            <span className="ps-logo-box" data-empty={logoKey ? undefined : true}>
              {logoKey ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/media/${logoKey}`} alt="Project logo" data-testid="logo-preview" />
              ) : (
                <Icon name="image" />
              )}
            </span>
            <div className="stack ps-logo-actions">
              <div className="row">
                <button type="button" className="secondary small" onClick={() => file.current?.click()} disabled={logoBusy !== null}>
                  <Icon name="upload" />
                  {logoBusy === "upload" ? "Uploading…" : logoKey ? "Replace logo" : "Upload logo"}
                </button>
                {logoKey && (
                  <button type="button" className="ghost small" onClick={removeLogo} disabled={logoBusy !== null}>
                    {logoBusy === "remove" ? "Removing…" : "Remove"}
                  </button>
                )}
              </div>
              <p className="hint xsmall">PNG, JPEG, WebP or GIF. A square image at least 128 pixels wide looks best.</p>
              <input
                ref={file}
                type="file"
                accept={ACCEPT}
                className="visually-hidden"
                tabIndex={-1}
                aria-label="Logo file"
                onChange={(e) => void upload(e.target.files?.[0])}
              />
            </div>
          </div>
          {logoError && (
            <p className="error" role="alert">
              {logoError}
            </p>
          )}
        </div>

        <div className="ps-brand-grid">
          <div className="stack">
            <h3 className="ps-subtitle">Colours</h3>
            <div className="ps-colors">
              <ColorField label="Primary" value={colors.primary} onChange={set("primary")} allowEmpty placeholder={accentColor} testId="brand-primary" />
              <ColorField label="Background" value={colors.background} onChange={set("background")} allowEmpty placeholder="#ffffff" />
              <ColorField label="Text" value={colors.text} onChange={set("text")} allowEmpty placeholder="#161b2e" contrastWith={background} />
              <ColorField label="Button" value={colors.button} onChange={set("button")} allowEmpty placeholder={primary} />
              <ColorField
                label="Button text"
                value={colors.buttonText}
                onChange={set("buttonText")}
                allowEmpty
                placeholder={readableOn(button)}
                contrastWith={button}
              />
              <ColorField label="Stars" value={colors.star} onChange={set("star")} allowEmpty placeholder="#f2a93b" contrastWith={background} minContrast={3} />
            </div>
          </div>

          <div className="stack">
            <h3 className="ps-subtitle">Preview</h3>
            <div className="ps-preview" style={preview} aria-hidden data-testid="brand-preview">
              {logoKey && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="ps-preview-logo" src={`/api/media/${logoKey}`} alt="" />
              )}
              <p className="ps-preview-heading" style={{ fontFamily: familyOf(fonts.heading) }}>
                What our customers say
              </p>
              <span className="ps-preview-stars" style={{ color: star }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Icon key={n} name="star" />
                ))}
              </span>
              <p className="ps-preview-body" style={{ fontFamily: familyOf(fonts.body) }}>
                “Setting it up took two minutes, and it looks like part of our site.”
              </p>
              <span className="ps-preview-link" style={{ color: primary }}>
                Read more stories
              </span>
              <span className="ps-preview-button" style={{ background: button, color: buttonText }}>
                Share yours
              </span>
            </div>
          </div>
        </div>

        <div className="ps-fonts">
          <FontField label="Heading font" value={fonts.heading} onChange={(id) => setFonts((f) => ({ ...f, heading: id }))} choices={FONTS} sample="Ag" />
          <FontField label="Body font" value={fonts.body} onChange={(id) => setFonts((f) => ({ ...f, body: id }))} choices={FONTS} sample="Ag" />
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="button" onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save brand kit"}
          </button>
          {dirty && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setColors(saved.colors);
                setFonts(saved.fonts);
              }}
              disabled={saving}
            >
              Undo changes
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
