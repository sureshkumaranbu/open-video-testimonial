"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/app/admin/api";
import { Toggle } from "@/components/admin";
import { PERSON_KEYS } from "@/lib/forms/engine";
import { AUTO_APPROVE_MODES, type AutoApproveRule, type FormSettings } from "@/lib/forms/schema";
import type { FormRow } from "../types";
import type { BuilderProject, Draft } from "./Builder";
import { NotifySection } from "./NotifySection";
import { LowRatingEditor, RewardsEditor } from "./RewardsEditor";

const MODE_NAMES: Record<AutoApproveRule["mode"], string> = {
  off: "Off: everything waits for you",
  all: "Every testimonial",
  rating: "Ratings at or above a number of stars",
  text: "Written testimonials only",
  public: "Anything they agreed to make public",
};

const PERSON_NAMES: Record<string, string> = { name: "Name", email: "Email", title: "Role / title", company: "Company", website: "Website", phone: "Phone" };

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

type Hook = { id: string; url: string; events: string[]; formId: string | null; active: boolean };

/** This form's own webhooks (FORM-10 override): they hear only its testimonials. */
function FormWebhooks({ projectId, formId }: { projectId: string; formId: string }) {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [url, setUrl] = useState("");
  const [submitted, setSubmitted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const all = (await api<{ webhooks: Hook[] }>("/api/admin/webhooks")).webhooks;
    setHooks(all.filter((h) => h.formId === formId));
  }, [formId]);
  useEffect(() => {
    void load().catch((e) => setError((e as Error).message));
  }, [load]);
  return (
    <fieldset className="fb-fieldset" data-testid="form-webhooks">
      <legend>Form webhooks</legend>
      <p className="muted xsmall">Webhooks here receive this form&apos;s testimonials only. Project-wide webhooks live in Settings.</p>
      {hooks.map((h) => (
        <div key={h.id} className="row spread">
          <span className="small" style={{ overflowWrap: "anywhere" }}>
            {h.url} <span className="muted xsmall">({h.events.length ? h.events.join(", ") : "default events"})</span>
          </span>
          <button
            type="button"
            className="danger small"
            onClick={async () => {
              await api(`/api/admin/webhooks/${h.id}`, { method: "DELETE" });
              await load();
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <form
        className="stack"
        style={{ gap: 6 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await api("/api/admin/webhooks", {
              method: "POST",
              json: { url, projectId, formId, events: submitted ? ["testimonial.created", "testimonial.approved", "form.submitted"] : [] },
            });
            setUrl("");
            await load();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <label>
          Endpoint URL
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/plaudit" required />
        </label>
        <label className="check xsmall">
          <input type="checkbox" checked={submitted} onChange={(e) => setSubmitted(e.target.checked)} />
          Created, approved and form.submitted (otherwise the default events)
        </label>
        <div>
          <button type="submit" className="secondary small" disabled={!url}>
            Add webhook
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </fieldset>
  );
}

/** INBOX-13: languages to machine-translate new testimonials into, typed as codes ("fr, de"). */
function AutoTranslateField({ value, provider, onChange }: { value: string[]; provider: string | null; onChange: (langs: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => setText(value.join(", ")), [value]);
  const commit = () => {
    const langs = [...new Set(text.split(/[\s,]+/).map((l) => l.trim().toLowerCase()).filter((l) => /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/.test(l)))].slice(0, 10);
    setText(langs.join(", "));
    if (langs.join() !== value.join()) onChange(langs);
  };
  return (
    <label>
      Translate new testimonials into
      <input type="text" value={text} placeholder="fr, de, pt-br" onChange={(e) => setText(e.target.value)} onBlur={commit} data-testid="form-auto-translate" />
      <span className="hint xsmall">
        {provider
          ? `Language codes, up to 10. ${provider} translates each one as it arrives; you can edit the result in the inbox.`
          : "Needs a translation provider on this server (TRANSLATE_PROVIDER). Until then nothing is translated."}
      </span>
    </label>
  );
}

/** FORM-10: link, status, rules and messages for this form. */
export function SettingsEditor({
  project,
  form,
  draft,
  update,
  dirty,
  onAction,
}: {
  project: BuilderProject;
  form: FormRow;
  draft: Draft;
  update: (fn: (d: Draft) => Draft) => void;
  dirty: boolean;
  onAction: (path: string, init: { method: string; json?: unknown }, done?: string) => Promise<void>;
}) {
  const s = draft.settings;
  const set = (patch: Partial<FormSettings>) => update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  const rule = s.autoApprove;
  const setRule = (patch: Partial<AutoApproveRule>) => set({ autoApprove: { ...rule, ...patch } });
  const [slug, setSlug] = useState(form.slug);
  useEffect(() => setSlug(form.slug), [form.slug]);

  return (
    <div className="stack fb-editor" data-testid="settings-editor">
      <h2 className="section-title">Form</h2>
      <label>
        Name
        <input type="text" value={draft.name} maxLength={120} onChange={(e) => update((d) => ({ ...d, name: e.target.value }))} />
      </label>
      <form
        className="stack"
        style={{ gap: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          void onAction(`/api/admin/forms/${form.id}/slug`, { method: "POST", json: { slug } }, "Link changed");
        }}
      >
        <label>
          Link
          <span className="hint xsmall">/f/{project.slug}/</span>
          <input type="text" value={slug} maxLength={48} onChange={(e) => setSlug(e.target.value)} data-testid="form-slug" />
        </label>
        {slug !== form.slug && (
          <p className="notice small">
            Links already shared with the old address keep working: they move on to the new one. QR codes and embeds you
            made before still point to the old address.
          </p>
        )}
        <div>
          <button type="submit" className="secondary small" disabled={slug === form.slug || !slug}>
            Change link
          </button>
        </div>
      </form>
      {!form.isDefault && (
        <div>
          <button type="button" className="secondary small" disabled={dirty} onClick={() => onAction(`/api/admin/forms/${form.id}/default`, { method: "POST" }, "Now the default form")}>
            Make this the default form
          </button>
          <p className="muted xsmall">The default form is what /c/{project.slug} and requests without a form open.</p>
        </div>
      )}

      <h2 className="section-title">Status</h2>
      <Toggle
        label="Taking testimonials"
        hint={form.status === "paused" ? "Paused: visitors see the message below." : "Live."}
        checked={form.status === "live"}
        onChange={(live) => onAction(`/api/admin/forms/${form.id}`, { method: "PATCH", json: { status: live ? "live" : "paused" } }, live ? "Form is live" : "Form paused")}
        testId="form-live"
      />
      <label>
        Message while paused
        <textarea value={s.closedMessage} maxLength={1000} rows={3} onChange={(e) => set({ closedMessage: e.target.value })} placeholder="It isn't taking new testimonials right now." />
      </label>

      <h2 className="section-title">Auto-approve</h2>
      <label>
        Approve automatically
        <select value={rule.mode} onChange={(e) => setRule({ mode: e.target.value as AutoApproveRule["mode"] })} data-testid="auto-approve-mode">
          {AUTO_APPROVE_MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_NAMES[m]}
            </option>
          ))}
        </select>
      </label>
      {rule.mode === "rating" && (
        <label>
          At least
          <select value={rule.minRating} onChange={(e) => setRule({ minRating: Number(e.target.value) as AutoApproveRule["minRating"] })} data-testid="auto-approve-min">
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} star{n > 1 ? "s" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {rule.mode !== "off" && (
        <>
          <Toggle label="Include videos (once processed)" checked={rule.includeVideo} onChange={(includeVideo) => setRule({ includeVideo })} />
          <p className="muted xsmall">Text with a link always waits for you. Testimonials kept private are never approved.</p>
        </>
      )}

      <h2 className="section-title">Tags and fields</h2>
      <label>
        Tags every testimonial gets
        <input type="text" value={s.autoTags.join(", ")} onChange={(e) => set({ autoTags: list(e.target.value).slice(0, 20).map((t) => t.slice(0, 32)) })} placeholder="newsletter, spring" />
      </label>
      <label>
        Hidden fields from the link
        <span className="hint xsmall">Parameter names to keep, e.g. utm_source, order_id. Stored privately.</span>
        <input
          type="text"
          value={s.hiddenFields.join(", ")}
          onChange={(e) => set({ hiddenFields: list(e.target.value).map((k) => k.toLowerCase().replace(/[^a-z0-9_]/g, "_")).filter((k) => /^[a-z]/.test(k)).slice(0, 20) })}
          data-testid="hidden-fields"
        />
      </label>
      <fieldset className="fb-fieldset">
        <legend>Prefilled details they can&apos;t change</legend>
        {PERSON_KEYS.map((k) => (
          <label key={k} className="check">
            <input
              type="checkbox"
              checked={s.lockPrefill.includes(k)}
              onChange={(e) => set({ lockPrefill: e.target.checked ? [...s.lockPrefill, k] : s.lockPrefill.filter((x) => x !== k) })}
            />
            {PERSON_NAMES[k]}
          </label>
        ))}
      </fieldset>

      <h2 className="section-title">Email and limits</h2>
      <Toggle
        label="Send a receipt to the author"
        hint="Only for personal request links, so the form can't be used to email strangers. It includes their private withdraw link."
        checked={s.confirmationEmail.enabled}
        onChange={(enabled) => set({ confirmationEmail: { ...s.confirmationEmail, enabled } })}
      />
      {s.confirmationEmail.enabled && (
        <>
          <label>
            Subject
            <input type="text" maxLength={200} value={s.confirmationEmail.subject} placeholder="Thanks for your testimonial for {project}" onChange={(e) => set({ confirmationEmail: { ...s.confirmationEmail, subject: e.target.value } })} />
          </label>
          <label>
            Message
            <span className="hint xsmall">{"{project}"} and {"{link}"} (their withdraw link) are filled in. The link is added if you leave it out.</span>
            <textarea rows={4} maxLength={5000} value={s.confirmationEmail.body} onChange={(e) => set({ confirmationEmail: { ...s.confirmationEmail, body: e.target.value } })} />
          </label>
        </>
      )}
      <label>
        Most testimonials from one place per day
        <input
          type="number"
          min={1}
          max={1000}
          value={s.maxPerIpPerDay ?? ""}
          placeholder="No limit"
          onChange={(e) => set({ maxPerIpPerDay: e.target.value ? Math.min(1000, Math.max(1, Number(e.target.value))) : null })}
        />
      </label>
      <Toggle label="Suggest turning the phone sideways before recording" checked={s.landscapePrompt} onChange={(landscapePrompt) => set({ landscapePrompt })} />
      <Toggle label="Hide this form from search engines" checked={s.noindex} onChange={(noindex) => set({ noindex })} />
      {project.translations && <AutoTranslateField value={s.autoTranslate} provider={project.translations.provider} onChange={(autoTranslate) => set({ autoTranslate })} />}

      <LowRatingEditor value={s.lowRating} onChange={(lowRating) => set({ lowRating })} pages={draft.pages} classic={form.layout === "classic"} />
      <RewardsEditor formId={form.id} projectId={project.id} reward={draft.reward} onChange={(reward) => update((d) => ({ ...d, reward }))} classic={form.layout === "classic"} stripe={Boolean(project.commerce)} />

      <NotifySection projectId={project.id} formId={form.id} value={s.notify.channelIds} onChange={(channelIds) => set({ notify: { channelIds } })} />
      <FormWebhooks projectId={project.id} formId={form.id} />
    </div>
  );
}
