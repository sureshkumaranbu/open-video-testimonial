"use client";

import { useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { AuthorImages } from "./AuthorImages";

export type EditableTestimonial = {
  id: string;
  authorName: string;
  authorTitle: string | null;
  authorCompany: string | null;
  authorWebsite: string | null;
  avatarKey: string | null;
  companyLogoKey: string | null;
  rating: number | null;
  headline: string | null;
  text: string | null;
  primaryQuestion: string | null;
  sourceDate: string | null;
  datePrecision: "day" | "month" | "year";
  platform: string | null;
  sourceUrl: string | null;
  language: string | null;
  tags: string[];
};
export type EditableAnswer = { id: string; questionTitle: string; text: string | null };

type Values = {
  authorName: string;
  authorTitle: string;
  authorCompany: string;
  authorWebsite: string;
  rating: string;
  headline: string;
  text: string;
  sourceDate: string;
  datePrecision: "day" | "month" | "year";
  platform: string;
  sourceUrl: string;
  language: string;
  tags: string;
};

function valuesOf(t: EditableTestimonial): Values {
  return {
    authorName: t.authorName,
    authorTitle: t.authorTitle ?? "",
    authorCompany: t.authorCompany ?? "",
    authorWebsite: t.authorWebsite ?? "",
    rating: t.rating ? String(t.rating) : "",
    headline: t.headline ?? "",
    text: t.text ?? "",
    sourceDate: t.sourceDate ? t.sourceDate.slice(0, 10) : "",
    datePrecision: t.datePrecision,
    platform: t.platform ?? "",
    sourceUrl: t.sourceUrl ?? "",
    language: t.language ?? "",
    tags: t.tags.join(", "),
  };
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

/**
 * Everything about a testimonial the owner can correct (INBOX-08), the text
 * of every answer included. Changes to what the author wrote mark it
 * "edited after consent"; every change is in the history. The photo and
 * logo save on their own (`onImagesChanged` reloads), the rest with the button.
 */
export function EditForm({
  t,
  answers,
  onSaved,
  onCancel,
  onImagesChanged,
}: {
  t: EditableTestimonial;
  answers: EditableAnswer[];
  onSaved: () => void;
  onCancel: () => void;
  onImagesChanged: () => void;
}) {
  const initial = valuesOf(t);
  const [v, setV] = useState<Values>(initial);
  const [answerText, setAnswerText] = useState<Record<string, string>>(() => Object.fromEntries(answers.map((a) => [a.id, a.text ?? ""])));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const patch: Record<string, unknown> = {};
    const changed = (k: keyof Values) => v[k] !== initial[k];
    if (changed("authorName")) patch.authorName = v.authorName.trim();
    if (changed("authorTitle")) patch.authorTitle = orNull(v.authorTitle);
    if (changed("authorCompany")) patch.authorCompany = orNull(v.authorCompany);
    if (changed("authorWebsite")) patch.authorWebsite = orNull(v.authorWebsite);
    if (changed("rating")) patch.rating = v.rating ? Number(v.rating) : null;
    if (changed("headline")) patch.headline = orNull(v.headline);
    if (changed("text")) patch.text = orNull(v.text);
    if (changed("sourceDate")) patch.sourceDate = v.sourceDate || null;
    if (changed("datePrecision")) patch.datePrecision = v.datePrecision;
    if (changed("platform")) patch.platform = orNull(v.platform);
    if (changed("sourceUrl")) patch.sourceUrl = orNull(v.sourceUrl);
    if (changed("language")) patch.language = orNull(v.language);
    if (changed("tags")) patch.tags = v.tags.split(",").map((s) => s.trim()).filter(Boolean);
    const answerEdits = answers.filter((a) => (answerText[a.id] ?? "") !== (a.text ?? ""));
    if (!Object.keys(patch).length && !answerEdits.length) {
      onCancel();
      return;
    }
    setSaving(true);
    try {
      if (Object.keys(patch).length) await api(`/api/admin/testimonials/${t.id}`, { method: "PATCH", json: patch });
      for (const a of answerEdits) await api(`/api/admin/answers/${a.id}`, { method: "PATCH", json: { text: orNull(answerText[a.id] ?? "") } });
      setError(null);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack ib-edit" onSubmit={submit} data-testid="edit-form">
      <AuthorImages testimonialId={t.id} avatarKey={t.avatarKey} companyLogoKey={t.companyLogoKey} onChanged={onImagesChanged} />
      <div className="ib-edit-grid">
        <label>
          Name
          <input type="text" value={v.authorName} onChange={set("authorName")} required maxLength={120} />
        </label>
        <label>
          Job title
          <input type="text" value={v.authorTitle} onChange={set("authorTitle")} maxLength={120} />
        </label>
        <label>
          Company
          <input type="text" value={v.authorCompany} onChange={set("authorCompany")} maxLength={120} />
        </label>
        <label>
          Website
          <input type="url" value={v.authorWebsite} onChange={set("authorWebsite")} placeholder="https://" />
        </label>
        <label>
          Rating
          <select value={v.rating} onChange={set("rating")}>
            <option value="">No rating</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "star" : "stars"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Language
          <input type="text" value={v.language} onChange={set("language")} placeholder="en" maxLength={35} />
        </label>
      </div>
      <label>
        Headline
        <input type="text" value={v.headline} onChange={set("headline")} maxLength={200} />
      </label>
      <label>
        {t.primaryQuestion ? `Answer to “${t.primaryQuestion}”` : "Testimonial text"}
        <textarea value={v.text} onChange={set("text")} rows={4} maxLength={5000} data-testid="edit-text" />
      </label>
      {answers.map((a) => (
        <label key={a.id}>
          Answer to “{a.questionTitle}”
          <textarea
            value={answerText[a.id] ?? ""}
            onChange={(e) => setAnswerText((x) => ({ ...x, [a.id]: e.target.value }))}
            rows={3}
            maxLength={5000}
            data-testid="edit-answer"
          />
        </label>
      ))}
      <div className="ib-edit-grid">
        <label>
          Source platform
          <input type="text" value={v.platform} onChange={set("platform")} placeholder="google, trustpilot…" maxLength={40} />
        </label>
        <label>
          Source link
          <input type="url" value={v.sourceUrl} onChange={set("sourceUrl")} placeholder="https://" />
        </label>
        <label>
          Date posted
          <input type="date" value={v.sourceDate} onChange={set("sourceDate")} />
        </label>
        <label>
          Date known to the
          <select value={v.datePrecision} onChange={set("datePrecision")}>
            <option value="day">Day</option>
            <option value="month">Month</option>
            <option value="year">Year</option>
          </select>
        </label>
      </div>
      <label>
        Tags (comma separated)
        <input type="text" value={v.tags} onChange={set("tags")} placeholder="homepage, pricing" />
      </label>
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" disabled={saving || !v.authorName.trim()}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
