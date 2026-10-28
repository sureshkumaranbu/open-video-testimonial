"use client";

import { Toggle } from "@/components/admin";
import { MAX_QUESTIONS, RESPONSE_MODES, FIELD_TYPES, FORM_CONSENT_SCOPES, type CustomField, type FormPage, type QuestionPage } from "@/lib/forms/schema";
import type { Draft } from "./Builder";
import { OwnerVideoPanel, type OwnerVideoPanelProps } from "./OwnerVideoPanel";

const PAGE_NAMES: Record<FormPage["type"], string> = {
  rating: "Rating",
  welcome: "Welcome",
  question: "Question",
  feedback: "Private question",
  consent: "Consent",
  about_you: "About you",
  about_company: "About your company",
  review: "Review and send",
  thank_you: "Thank you",
};

const MODE_NAMES: Record<(typeof RESPONSE_MODES)[number], string> = { video_text: "Video or text", video: "Video only", text: "Text only" };
const FIELD_NAMES: Record<(typeof FIELD_TYPES)[number], string> = {
  short: "Short text",
  long: "Long text",
  dropdown: "Dropdown",
  checkbox: "Checkbox",
  nps: "NPS 0–10",
  url: "Web address",
  number: "Number",
};
const SCOPE_NAMES: Record<string, string> = { social: "Social media", ads: "Paid ads", name: "Full name", face: "Face" };

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

/** A key no question or field of the form uses yet: q2, q3… or field_2… */
function freeKey(pages: FormPage[], prefix: string) {
  const used = new Set(
    pages.flatMap((p) => [
      ...(p.type === "question" || p.type === "feedback" ? [p.key] : []),
      ...(p.type === "about_you" || p.type === "about_company" ? p.custom.map((f) => f.key) : []),
    ]),
  );
  for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

function pageTitle(p: FormPage) {
  if (p.type === "question") return p.title || "Question";
  if (p.type === "feedback") return p.title || PAGE_NAMES.feedback;
  return PAGE_NAMES[p.type];
}

/**
 * The page list: each page can be turned on or off (not the main question),
 * questions move up and down among themselves, and questions or private
 * questions can be added and removed.
 */
export function PageList({
  pages,
  selected,
  onSelect,
  onChange,
  editable,
}: {
  pages: FormPage[];
  selected: number;
  onSelect: (i: number) => void;
  onChange: (pages: FormPage[]) => void;
  editable: boolean;
}) {
  const questions = pages.filter((p) => p.type === "question");
  const set = (i: number, page: FormPage) => onChange(pages.map((p, j) => (j === i ? page : p)));
  const move = (i: number, dir: -1 | 1) => {
    // Swap with the next question in that direction, so other pages keep their place.
    let j = i + dir;
    while (j >= 0 && j < pages.length && pages[j].type !== "question") j += dir;
    if (j < 0 || j >= pages.length) return;
    const next = [...pages];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    onSelect(j);
  };
  const add = (type: "question" | "feedback") => {
    const lastQuestion = pages.map((p) => p.type).lastIndexOf("question");
    const at = lastQuestion + 1;
    const page: FormPage =
      type === "question"
        ? { type: "question", key: freeKey(pages, "q"), enabled: true, primary: false, required: false, title: "Another question", tips: [], mode: "video_text", maxVideoSeconds: 120, allowImages: 0 }
        : { type: "feedback", key: freeKey(pages, "private"), enabled: true, required: false, title: "Anything you'd like to tell us privately?" };
    onChange([...pages.slice(0, at), page, ...pages.slice(at)]);
    onSelect(at);
  };
  const remove = (i: number) => {
    onChange(pages.filter((_, j) => j !== i));
    onSelect(Math.max(0, i - 1));
  };

  return (
    <div className="stack" style={{ gap: "var(--space-2)" }}>
      <ol className="fb-page-list" data-testid="page-list">
        {pages.map((p, i) => {
          const canToggle = "enabled" in p && !(p.type === "question" && p.primary);
          const isQ = p.type === "question";
          return (
            <li key={"key" in p ? `${p.type}:${p.key}` : p.type} data-selected={i === selected} data-type={p.type} data-enabled={"enabled" in p ? p.enabled : true}>
              <button type="button" className="fb-page-pick" aria-pressed={i === selected} onClick={() => onSelect(i)}>
                <span className="fb-page-kind">{p.type === "question" && p.primary ? "Main question" : PAGE_NAMES[p.type]}</span>
                <span className="fb-page-title">{pageTitle(p)}</span>
              </button>
              {editable && (
                <span className="fb-page-tools">
                  {canToggle && (
                    <Toggle
                      label={`Show ${pageTitle(p)}`}
                      hideLabel
                      checked={(p as { enabled: boolean }).enabled}
                      onChange={(enabled) => set(i, { ...p, enabled } as FormPage)}
                    />
                  )}
                  {isQ && (
                    <>
                      <button type="button" className="ghost small" aria-label={`Move ${pageTitle(p)} up`} onClick={() => move(i, -1)}>
                        ↑
                      </button>
                      <button type="button" className="ghost small" aria-label={`Move ${pageTitle(p)} down`} onClick={() => move(i, 1)}>
                        ↓
                      </button>
                    </>
                  )}
                  {((isQ && !p.primary) || p.type === "feedback") && (
                    <button type="button" className="danger small" aria-label={`Remove ${pageTitle(p)}`} onClick={() => remove(i)}>
                      ×
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {editable && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="secondary small" onClick={() => add("question")} disabled={questions.length >= MAX_QUESTIONS}>
            Add question
          </button>
          <button type="button" className="secondary small" onClick={() => add("feedback")}>
            Add private question
          </button>
        </div>
      )}
    </div>
  );
}

function Text({ label, value, onChange, multiline, hint, max = 300, placeholder }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; hint?: string; max?: number; placeholder?: string }) {
  return (
    <label>
      {label}
      {hint && <span className="hint xsmall">{hint}</span>}
      {multiline ? (
        <textarea value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} rows={4} />
      ) : (
        <input type="text" value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

/** Dropdown choices as lines: "Enterprise = enterprise" adds the tag "enterprise" to whoever picks it. */
const optionsToText = (f: CustomField) => (f.options ?? []).map((o) => (o.tag ? `${o.label} = ${o.tag}` : o.label)).join("\n");
const textToOptions = (s: string) =>
  lines(s)
    .slice(0, 50)
    .map((l) => {
      const [label, tag] = l.split("=").map((x) => x.trim());
      return tag ? { label: label.slice(0, 100), tag: tag.slice(0, 32) } : { label: label.slice(0, 100) };
    });

function CustomFieldsEditor({ fields, onChange, pages }: { fields: CustomField[]; onChange: (f: CustomField[]) => void; pages: FormPage[] }) {
  const set = (i: number, patch: Partial<CustomField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <fieldset className="fb-fieldset" data-testid="custom-fields">
      <legend>Custom fields</legend>
      {fields.map((f, i) => (
        <div key={i} className="fb-custom card">
          <div className="fb-grid2">
            <Text label="Label" value={f.label} onChange={(label) => set(i, { label })} max={200} />
            <label>
              Type
              <select value={f.type} onChange={(e) => set(i, { type: e.target.value as CustomField["type"] })}>
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FIELD_NAMES[t]}
                  </option>
                ))}
              </select>
            </label>
            <Text label="Key" value={f.key} onChange={(key) => set(i, { key: key.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} max={40} hint="In exports as custom:<key>" />
            <Text label="Placeholder" value={f.placeholder ?? ""} onChange={(placeholder) => set(i, { placeholder })} max={200} />
          </div>
          {f.type === "dropdown" && (
            <Text
              label="Choices, one per line"
              hint="Add “= tag” to tag whoever picks it, e.g. Enterprise = enterprise"
              value={optionsToText(f)}
              onChange={(v) => set(i, { options: textToOptions(v) })}
              multiline
              max={5000}
            />
          )}
          <div className="row spread">
            <Toggle label="Required" checked={f.required} onChange={(required) => set(i, { required })} />
            <button type="button" className="danger small" onClick={() => onChange(fields.filter((_, j) => j !== i))}>
              Remove field
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="secondary small"
        disabled={fields.length >= 20}
        onClick={() => onChange([...fields, { key: freeKey(pages, "field_"), type: "short", label: "New field", required: false }])}
      >
        Add custom field
      </button>
    </fieldset>
  );
}

type DetailKey = "email" | "photo" | "title" | "company" | "website" | "phone" | "socials" | "logo";
const DETAIL_NAMES: Record<DetailKey, string> = {
  email: "Email",
  photo: "Photo",
  title: "Role / title",
  company: "Company",
  website: "Website",
  phone: "Phone",
  socials: "Social profiles",
  logo: "Company logo",
};

function Details<K extends DetailKey>({
  fields,
  onChange,
}: {
  fields: Record<K, { enabled: boolean; required: boolean }>;
  onChange: (f: Record<K, { enabled: boolean; required: boolean }>) => void;
}) {
  return (
    <fieldset className="fb-fieldset">
      <legend>Details to ask for</legend>
      {(Object.keys(fields) as K[]).map((k) => (
        <div key={k} className="row spread">
          <Toggle label={DETAIL_NAMES[k]} checked={fields[k].enabled} onChange={(enabled) => onChange({ ...fields, [k]: { ...fields[k], enabled } })} />
          <label className="check xsmall">
            <input
              type="checkbox"
              checked={fields[k].required}
              disabled={!fields[k].enabled}
              onChange={(e) => onChange({ ...fields, [k]: { ...fields[k], required: e.target.checked } })}
            />
            Required
          </label>
        </div>
      ))}
    </fieldset>
  );
}

function QuestionEditor({ page, onChange }: { page: QuestionPage; onChange: (p: FormPage) => void }) {
  const set = (patch: Partial<QuestionPage>) => onChange({ ...page, ...patch });
  return (
    <>
      <Text label="Question" value={page.title} onChange={(title) => set({ title })} />
      <Text label="Subtitle" value={page.subtitle ?? ""} onChange={(subtitle) => set({ subtitle: subtitle || undefined })} max={500} multiline />
      {page.mode !== "text" && (
        <Text
          label="Subtitle when recording"
          hint="Leave empty to use the one above"
          value={page.videoSubtitle ?? ""}
          onChange={(videoSubtitle) => set({ videoSubtitle: videoSubtitle || undefined })}
          max={500}
          multiline
        />
      )}
      <Text
        label="Tips, one per line (up to 8)"
        hint="Shown beside the answer and over the camera"
        value={page.tips.join("\n")}
        onChange={(v) => set({ tips: lines(v).slice(0, 8).map((t) => t.slice(0, 200)) })}
        multiline
        max={2000}
      />
      <div className="fb-grid2">
        <label>
          Answer with
          <select value={page.mode} onChange={(e) => set({ mode: e.target.value as QuestionPage["mode"] })} data-testid="question-mode">
            {RESPONSE_MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_NAMES[m]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Longest video (seconds)
          <input
            type="number"
            min={15}
            max={600}
            value={page.maxVideoSeconds}
            onChange={(e) => set({ maxVideoSeconds: Math.min(600, Math.max(15, Number(e.target.value) || 120)) })}
          />
        </label>
        <label>
          Images they may add
          <select value={page.allowImages} onChange={(e) => set({ allowImages: Number(e.target.value) })}>
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "None" : n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Toggle
        label="Required"
        hint={page.required ? "They must answer before going on." : "They can skip it."}
        checked={page.required}
        onChange={(required) => set({ required })}
      />
      {!page.primary && (
        <button
          type="button"
          className="secondary small"
          onClick={() => onChange({ ...page, primary: true, enabled: true })}
          data-make-main={page.key}
        >
          Make this the main question
        </button>
      )}
      <p className="muted xsmall">Key: {page.key} (in exports and links)</p>
    </>
  );
}

/** The selected page's settings (FORM-02, right-hand panel, Content tab). */
export function ContentEditor({
  draft,
  index,
  onChange,
  ownerVideo,
}: {
  draft: Draft;
  index: number;
  onChange: (pages: FormPage[]) => void;
  /** FORM-17 (video2 flag): the owner's own video on the welcome and thank-you pages. */
  ownerVideo?: Omit<OwnerVideoPanelProps, "slot">;
}) {
  const page = draft.pages[index];
  if (!page) return <p className="muted">Pick a page on the left.</p>;
  const set = (p: FormPage) =>
    onChange(
      draft.pages.map((x, j) => {
        if (j === index) return p;
        // Only one main question.
        if (p.type === "question" && p.primary && x.type === "question" && x.primary) return { ...x, primary: false };
        return x;
      }),
    );
  return (
    <div className="stack fb-editor" data-testid="page-editor" data-type={page.type}>
      <h2 className="section-title">{PAGE_NAMES[page.type]}</h2>
      {(() => {
        switch (page.type) {
          case "rating":
            return (
              <>
                <Text label="Title" value={page.title} placeholder="How was your experience?" onChange={(title) => set({ ...page, title })} />
                <Text label="Subtitle" value={page.subtitle ?? ""} onChange={(subtitle) => set({ ...page, subtitle: subtitle || undefined })} max={500} />
                <Toggle label="Rating required" checked={page.required} onChange={(required) => set({ ...page, required })} />
              </>
            );
          case "welcome":
            return (
              <>
                <Text label="Title" value={page.title} onChange={(title) => set({ ...page, title })} />
                <Text label="Message" value={page.message} onChange={(message) => set({ ...page, message })} max={2000} multiline />
                <Text
                  label="Points, one per line"
                  value={page.bullets.join("\n")}
                  onChange={(v) => set({ ...page, bullets: lines(v).slice(0, 6).map((b) => b.slice(0, 120)) })}
                  multiline
                  max={1000}
                />
                {ownerVideo && <OwnerVideoPanel {...ownerVideo} slot="welcome" pageOff={!page.enabled} />}
              </>
            );
          case "question":
            return <QuestionEditor page={page} onChange={set} />;
          case "feedback":
            return (
              <>
                <p className="muted small">The answer goes to private feedback and is never published.</p>
                <Text label="Question" value={page.title} onChange={(title) => set({ ...page, title })} />
                <Text label="Subtitle" value={page.subtitle ?? ""} onChange={(subtitle) => set({ ...page, subtitle: subtitle || undefined })} max={500} />
                <Text label="Placeholder" value={page.placeholder ?? ""} onChange={(placeholder) => set({ ...page, placeholder: placeholder || undefined })} max={200} />
                <Toggle label="Required" checked={page.required} onChange={(required) => set({ ...page, required })} />
              </>
            );
          case "consent":
            return (
              <>
                <Text
                  label="Consent wording"
                  hint="Leave empty for the standard wording in the form's language. {project} becomes your project's name."
                  value={page.text}
                  onChange={(text) => set({ ...page, text })}
                  multiline
                  max={1000}
                />
                <fieldset className="fb-fieldset">
                  <legend>Extra uses they can agree to</legend>
                  {FORM_CONSENT_SCOPES.filter((s) => s !== "website").map((s) => (
                    <label key={s} className="check">
                      <input
                        type="checkbox"
                        checked={page.scopes.includes(s)}
                        onChange={(e) => set({ ...page, scopes: e.target.checked ? [...page.scopes, s] : page.scopes.filter((x) => x !== s) })}
                      />
                      {SCOPE_NAMES[s]}
                    </label>
                  ))}
                </fieldset>
                <Toggle
                  label="Offer “keep it private”"
                  hint="Private testimonials can be read by your team but never published."
                  checked={page.allowPrivate}
                  onChange={(allowPrivate) => set({ ...page, allowPrivate })}
                />
              </>
            );
          case "about_you":
            return (
              <>
                <p className="muted small">Their name is always asked for.</p>
                <Details fields={page.fields} onChange={(fields) => set({ ...page, fields })} />
                <CustomFieldsEditor fields={page.custom} onChange={(custom) => set({ ...page, custom })} pages={draft.pages} />
              </>
            );
          case "about_company":
            return (
              <>
                <Details fields={page.fields} onChange={(fields) => set({ ...page, fields })} />
                <CustomFieldsEditor fields={page.custom} onChange={(custom) => set({ ...page, custom })} pages={draft.pages} />
              </>
            );
          case "review":
            return <Text label="Title" value={page.title} placeholder="Check and send" onChange={(title) => set({ ...page, title })} />;
          case "thank_you":
            return (
              <>
                <Text label="Title" value={page.title} placeholder="Thank you!" onChange={(title) => set({ ...page, title })} />
                <Text label="Message" value={page.message} onChange={(message) => set({ ...page, message })} max={2000} multiline />
                {ownerVideo && <OwnerVideoPanel {...ownerVideo} slot="thank_you" />}
                <fieldset className="fb-fieldset">
                  <legend>For 3 stars or fewer</legend>
                  <Text label="Title" value={page.low?.title ?? ""} onChange={(title) => set({ ...page, low: { title, message: page.low?.message ?? "" } })} />
                  <Text
                    label="Message"
                    value={page.low?.message ?? ""}
                    onChange={(message) => set({ ...page, low: { title: page.low?.title ?? "", message } })}
                    max={2000}
                    multiline
                  />
                </fieldset>
                <fieldset className="fb-fieldset">
                  <legend>Button (optional)</legend>
                  <div className="fb-grid2">
                    <Text
                      label="Button text"
                      value={page.cta?.label ?? ""}
                      placeholder="Also review us on Google"
                      max={80}
                      onChange={(label) => set({ ...page, cta: label || page.cta?.url ? { label, url: page.cta?.url ?? "" } : undefined })}
                    />
                    <Text
                      label="Link (https://…)"
                      value={page.cta?.url ?? ""}
                      max={2000}
                      onChange={(url) => set({ ...page, cta: url || page.cta?.label ? { label: page.cta?.label ?? "", url } : undefined })}
                    />
                  </div>
                </fieldset>
                <Toggle label="Offer “copy my words”" checked={page.copyText} onChange={(copyText) => set({ ...page, copyText })} />
                <Toggle
                  label="Share buttons"
                  hint="Shown only to people who agreed to social media use."
                  checked={page.share}
                  onChange={(share) => set({ ...page, share })}
                />
              </>
            );
        }
      })()}
    </div>
  );
}
