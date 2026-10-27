"use client";

import { useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { Icon } from "@/components/Icon";

export type TranslationJson = { id: string; lang: string; headline: string | null; text: string | null; machine: boolean; updatedAt: string };

const LANG = /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/;

/**
 * INBOX-13 in the drawer: the testimonial in other languages. Add or edit one
 * by hand, or have the owner's provider write it (marked "machine"). The
 * author's own words never change; widgets show a translation only to
 * visitors whose browser asks for that language.
 */
export function TranslationsPanel({
  testimonialId,
  translations,
  provider,
  onChanged,
}: {
  testimonialId: string;
  translations: TranslationJson[];
  provider: string | null;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [lang, setLang] = useState("");
  const [headline, setHeadline] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/admin/testimonials/${testimonialId}/translations`;
  const code = lang.trim().toLowerCase();
  const valid = LANG.test(code);

  function open(t?: TranslationJson) {
    setEditing(t ? t.lang : "new");
    setLang(t?.lang ?? "");
    setHeadline(t?.headline ?? "");
    setText(t?.text ?? "");
    setError(null);
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setEditing(null);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ib-section" aria-labelledby="ib-tr-title" data-testid="translations">
      <div className="row spread">
        <h3 id="ib-tr-title" className="ib-section-title">
          Translations
        </h3>
        {editing === null && (
          <button type="button" className="ghost small" onClick={() => open()} data-testid="translation-add">
            <Icon name="translate" />
            Add a translation
          </button>
        )}
      </div>
      {translations.length === 0 && editing === null && (
        <p className="muted xsmall">None yet. {provider ? `Add one by hand or let ${provider} write it.` : "Add one by hand. A translation provider on the server (TRANSLATE_PROVIDER) can write them for you."}</p>
      )}
      <ul className="ib-translations">
        {translations.map((t) => (
          <li key={t.id} data-testid="translation" data-lang={t.lang}>
            <div className="row spread">
              <span className="row" style={{ gap: "var(--space-2)" }}>
                <span className="badge">{t.lang}</span>
                {t.machine && <span className="badge" title="Written by your translation provider">Machine</span>}
              </span>
              <span className="row" style={{ gap: 4 }}>
                <button type="button" className="ghost small" onClick={() => open(t)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="ghost small"
                  disabled={busy}
                  onClick={() => confirm(`Remove the ${t.lang} translation?`) && void run(() => api(`${base}/${t.lang}`, { method: "DELETE" }))}
                >
                  Remove
                </button>
              </span>
            </div>
            {t.headline && <strong className="small">{t.headline}</strong>}
            {t.text && <p className="small" style={{ whiteSpace: "pre-line", margin: 0 }}>{t.text}</p>}
          </li>
        ))}
      </ul>
      {editing !== null && (
        <div className="stack ib-translation-edit" data-testid="translation-editor">
          <label className="small">
            Language code
            <input type="text" value={lang} onChange={(e) => setLang(e.target.value)} placeholder="fr, de, pt-br…" disabled={editing !== "new"} maxLength={20} data-testid="translation-lang" />
          </label>
          <label className="small">
            Headline
            <input type="text" value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={200} />
          </label>
          <label className="small">
            Text
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={10000} data-testid="translation-text" />
          </label>
          <div className="row">
            <button type="button" className="small" disabled={busy || !valid || (!text.trim() && !headline.trim())} onClick={() => void run(() => api(`${base}/${code}`, { method: "PUT", json: { headline, text } }))} data-testid="translation-save">
              {busy ? "Saving…" : "Save"}
            </button>
            {provider && (
              <button type="button" className="secondary small" disabled={busy || !valid} onClick={() => void run(() => api(base, { method: "POST", json: { lang: code } }))} data-testid="translation-machine">
                <Icon name="translate" />
                {busy ? "Translating…" : `Translate with ${provider}`}
              </button>
            )}
            <button type="button" className="ghost small" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
          {!valid && lang.trim() && <p className="hint">Use a language code such as fr, de or pt-br.</p>}
        </div>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
