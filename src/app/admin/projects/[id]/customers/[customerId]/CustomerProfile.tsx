"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { Checkbox, CopyField, Modal, Toast } from "@/components/admin";
import { Icon } from "@/components/Icon";
import { PlatformIcon, platformLabel } from "@/components/PlatformIcon";
import { Stars } from "@/components/TestimonialCard";
import type { CustomerProfile } from "@/lib/customer-records";
import { ManualAddModal } from "../../ManualAddModal";
import "@/app/admin/customers.css";

const STATUS: Record<string, string> = { pending: "Pending", approved: "Approved", hidden: "Hidden", rejected: "Rejected", trashed: "In the trash" };
const INVITE: Record<string, string> = { waiting: "Waiting", responded: "Responded", unsubscribed: "Unsubscribed", declined: "Declined" };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

type Edit = { name: string; email: string; title: string; company: string; website: string };

/**
 * INBOX-12: one person. Their details (editable here; their testimonials keep
 * what they wrote), everything they sent and were sent, and three ways to ask
 * for more: an invitation to a form, a request for a video, or adding one
 * yourself with their details filled in.
 */
export function CustomerProfileView({ projectId, initial, emailOn }: { projectId: string; initial: CustomerProfile; emailOn: boolean }) {
  const [p, setP] = useState(initial);
  const c = p.customer;
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<Edit>({ name: c.name, email: c.email ?? "", title: c.title ?? "", company: c.company ?? "", website: c.website ?? "" });
  const [inviting, setInviting] = useState<null | "form" | "video">(null);
  const [formId, setFormId] = useState("");
  const [send, setSend] = useState(emailOn);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const reload = async () => setP(await api<CustomerProfile>(`/api/admin/projects/${projectId}/customers/${c.id}`));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/projects/${projectId}/customers/${c.id}`, { method: "PATCH", json: edit });
      await reload();
      setEditing(false);
      setToast("Saved");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function openInvite(kind: "form" | "video") {
    const video = p.forms.find((f) => f.asksForVideo);
    setFormId(kind === "video" && video ? (video.isDefault ? "" : video.id) : "");
    setLink(null);
    setError(null);
    setSend(emailOn);
    setInviting(kind);
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { request } = await api<{ request: { link: string } }>(`/api/admin/projects/${projectId}/customers/${c.id}/invite`, {
        method: "POST",
        json: { formId: formId || null, send },
      });
      setLink(request.link);
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const videoForms = p.forms.filter((f) => f.asksForVideo);
  const chosenForm = p.forms.find((f) => (formId ? f.id === formId : f.isDefault));

  return (
    <div className="stack-lg" data-testid="customer-profile" data-id={c.id}>
      <div className="page-head">
        <div>
          <h1 data-testid="customer-name">{c.name}</h1>
          <p className="muted">
            {[c.title, c.company].filter(Boolean).join(", ") || "No job title or company yet"}
            {" · "}
            {c.email ?? "No email address"}
          </p>
        </div>
        <div className="cu-actions">
          <button type="button" className="secondary small" onClick={() => openInvite("form")} data-testid="customer-invite">
            <Icon name="mail" />
            Invite to a form
          </button>
          <button type="button" className="secondary small" onClick={() => openInvite("video")} data-testid="customer-ask-video">
            <Icon name="video" />
            Ask for a video
          </button>
          <ManualAddModal
            projectId={projectId}
            customerId={c.id}
            prefill={{ name: c.name, email: c.email ?? "", title: c.title ?? "", company: c.company ?? "", authorWebsite: c.website ?? "" }}
            onAdded={() => {
              void reload();
              setToast("Testimonial added");
            }}
          />
        </div>
      </div>

      <div className="cu-profile">
        <div className="stack-lg">
          <section className="panel" aria-labelledby="cu-t-h">
            <div className="panel-head">
              <h2 id="cu-t-h">Testimonials ({p.testimonials.length})</h2>
            </div>
            {p.testimonials.length === 0 ? (
              <p className="panel-body muted">None yet. Invite them to a form, or add one they sent you another way.</p>
            ) : (
              <ul className="cu-list" data-testid="customer-testimonials-list">
                {p.testimonials.map((t) => (
                  <li key={t.id} data-testid="customer-testimonial">
                    <div className="cu-meta">
                      <span className={`badge ${t.status}`}>{STATUS[t.status] ?? t.status}</span>
                      {t.rating ? <Stars rating={t.rating} /> : null}
                      {t.platform && (
                        <span className="muted xsmall row" style={{ gap: 4 }}>
                          <PlatformIcon platform={t.platform} /> {platformLabel(t.platform)}
                        </span>
                      )}
                      {t.hasVideo && <span className="badge">Video</span>}
                      <span className="muted xsmall">{day(t.createdAt)}</span>
                    </div>
                    {t.headline && <strong className="small">{t.headline}</strong>}
                    {t.text && <p className="cu-quote small">{t.text}</p>}
                    <Link className="small" href={`/admin/projects/${projectId}?tab=all&open=${t.id}`}>
                      Open in the inbox
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="cu-f-h">
            <div className="panel-head">
              <h2 id="cu-f-h">Private feedback ({p.feedback.length})</h2>
            </div>
            {p.feedback.length === 0 ? (
              <p className="panel-body muted">No private feedback from them.</p>
            ) : (
              <ul className="cu-list">
                {p.feedback.map((f) => (
                  <li key={f.id}>
                    <div className="cu-meta">
                      {f.rating ? <Stars rating={f.rating} /> : null}
                      <span className="muted xsmall">{day(f.createdAt)}</span>
                    </div>
                    <p className="cu-quote small">{f.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="cu-i-h">
            <div className="panel-head">
              <h2 id="cu-i-h">Invitations and campaign emails ({p.invites.length})</h2>
            </div>
            {p.invites.length === 0 ? (
              <p className="panel-body muted">{c.email ? "They haven't been invited yet." : "Add their email address to invite them."}</p>
            ) : (
              <ul className="cu-list" data-testid="customer-invites">
                {p.invites.map((r) => (
                  <li key={r.id} data-testid="customer-invite-row">
                    <div className="cu-meta">
                      <strong className="small">{r.campaign ? `Campaign: ${r.campaign}` : "Personal request"}</strong>
                      <span className="badge">{INVITE[r.status] ?? r.status}</span>
                      <span className="muted xsmall">
                        {r.sentAt ? `Sent ${day(r.sentAt)}` : `Created ${day(r.createdAt)}`}
                        {r.clickedAt ? ` · clicked ${day(r.clickedAt)}` : ""}
                        {r.respondedAt ? ` · responded ${day(r.respondedAt)}` : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="stack-lg">
          <section className="panel" aria-labelledby="cu-d-h">
            <div className="panel-head">
              <h2 id="cu-d-h">Details</h2>
              <button type="button" className="ghost small" onClick={() => setEditing(true)} data-testid="customer-edit">
                <Icon name="pen" />
                Edit
              </button>
            </div>
            <dl className="cu-details panel-body">
              <div>
                <dt>Email</dt>
                <dd>{c.email ?? "None"}</dd>
              </div>
              <div>
                <dt>Job title</dt>
                <dd>{c.title ?? "None"}</dd>
              </div>
              <div>
                <dt>Company</dt>
                <dd>{c.company ?? "None"}</dd>
              </div>
              <div>
                <dt>Website</dt>
                <dd>{c.website ? <a href={c.website} target="_blank" rel="noreferrer noopener">{c.website}</a> : "None"}</dd>
              </div>
              <div>
                <dt>First seen</dt>
                <dd>{day(c.createdAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="panel" aria-labelledby="cu-r-h">
            <div className="panel-head">
              <h2 id="cu-r-h">Rewards ({p.rewards.length})</h2>
            </div>
            {p.rewards.length === 0 ? (
              <p className="panel-body muted">No reward codes claimed.</p>
            ) : (
              <ul className="cu-list">
                {p.rewards.map((r) => (
                  <li key={r.id}>
                    <span className="cu-code">{r.code}</span>
                    <span className="muted xsmall">Claimed {day(r.claimedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit customer"
        description="Their testimonials keep what they wrote; this changes only the customer record."
        onSubmit={save}
        testId="customer-edit-dialog"
        footer={
          <>
            <button type="button" className="ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        {(["name", "email", "title", "company", "website"] as const).map((k) => (
          <label key={k}>
            {{ name: "Name", email: "Email", title: "Job title", company: "Company", website: "Website" }[k]}
            <input
              type={k === "email" ? "email" : k === "website" ? "url" : "text"}
              value={edit[k]}
              required={k === "name"}
              onChange={(e) => setEdit((x) => ({ ...x, [k]: e.target.value }))}
              data-autofocus={k === "name" ? true : undefined}
            />
          </label>
        ))}
        {error && editing && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </Modal>

      <Modal
        open={inviting !== null}
        onClose={() => setInviting(null)}
        title={inviting === "video" ? `Ask ${c.name} for a video` : `Invite ${c.name} to a form`}
        description={c.email ? `A personal link for ${c.email}. It appears in the Requests tab, with reminders if you've set them.` : undefined}
        onSubmit={invite}
        testId="customer-invite-dialog"
        footer={
          link ? (
            <button type="button" onClick={() => setInviting(null)}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="ghost" onClick={() => setInviting(null)}>
                Cancel
              </button>
              <button type="submit" disabled={busy || !c.email} data-testid="customer-invite-send">
                {busy ? "Creating…" : send ? "Send invitation" : "Create link"}
              </button>
            </>
          )
        }
      >
        {!c.email ? (
          <p className="error" role="alert">
            Add their email address first (Edit, in Details).
          </p>
        ) : link ? (
          <div className="stack" role="status">
            <p>{send ? "Invitation queued." : "Link created."} You can also share it yourself:</p>
            <CopyField label="Personal link" value={link} testId="customer-invite-link" />
          </div>
        ) : (
          <>
            <label>
              Form
              <select value={formId} onChange={(e) => setFormId(e.target.value)} data-testid="customer-invite-form">
                {p.forms.map((f) => (
                  <option key={f.id} value={f.isDefault ? "" : f.id}>
                    {f.name}
                    {f.isDefault ? " (default)" : ""}
                    {f.asksForVideo ? " · asks for a video" : ""}
                  </option>
                ))}
              </select>
            </label>
            {inviting === "video" && !videoForms.length && (
              <p className="hint">None of your forms asks for a video only yet. In the form builder, set the main question’s answer to Video, or pick a form that offers both.</p>
            )}
            {inviting === "video" && chosenForm && !chosenForm.asksForVideo && videoForms.length > 0 && (
              <p className="hint">This form also lets them answer in writing.</p>
            )}
            <Checkbox label={emailOn ? "Email them the link now" : "Email them the link (email isn't set up on this server)"} checked={send} onChange={setSend} disabled={!emailOn} />
          </>
        )}
        {error && inviting && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </Modal>
      <Toast message={toast} onDismiss={() => setToast(null)} testId="customer-toast" />
    </div>
  );
}
