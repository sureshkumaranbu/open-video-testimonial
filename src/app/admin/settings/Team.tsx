"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

type Role = "owner" | "admin" | "editor" | "viewer";
type Assignable = Exclude<Role, "owner">;

type Entry = {
  id: string | null;
  email: string;
  name: string | null;
  role: Role;
  projectIds: string[] | null;
  access: "owner" | "admin-emails" | "domain" | "invited";
  activatedAt: string | null;
  lastSignInAt: string | null;
};

type ProjectOption = { id: string; name: string };

const SOURCE: Record<Entry["access"], string> = {
  owner: "ADMIN_EMAIL",
  "admin-emails": "ADMIN_EMAILS",
  domain: "allowed domain",
  invited: "invited",
};

const ROLE_NAME: Record<Role, string> = { owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer" };

/** TEAM-01: what each role may do, as the invite form explains it. */
const ROLE_HELP: Record<Assignable, string> = {
  admin: "Everything except the team: settings, API keys, webhooks, every project",
  editor: "Testimonials, forms, widgets, walls, campaigns and imports, in the projects you choose",
  viewer: "Look and share approved testimonials, in the projects you choose",
};

/** Role and projects, for an invitation or a change. */
function AccessFields({
  role,
  setRole,
  projectIds,
  setProjectIds,
  projects,
  idPrefix,
}: {
  role: Assignable;
  setRole: (r: Assignable) => void;
  projectIds: string[] | null;
  setProjectIds: (ids: string[] | null) => void;
  projects: ProjectOption[];
  idPrefix: string;
}) {
  return (
    <div className="stack" style={{ gap: "var(--space-2)" }}>
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value as Assignable)} data-testid={`${idPrefix}-role`}>
          {(["admin", "editor", "viewer"] as const).map((r) => (
            <option key={r} value={r}>
              {ROLE_NAME[r]}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">{ROLE_HELP[role]}.</p>
      {role !== "admin" && (
        <fieldset className="stack" style={{ gap: "var(--space-1)", border: 0, padding: 0 }}>
          <legend className="small">Projects</legend>
          <label className="row small" style={{ gap: "var(--space-2)" }}>
            <input type="checkbox" checked={projectIds === null} onChange={(e) => setProjectIds(e.target.checked ? null : [])} />
            Every project, including new ones
          </label>
          {projectIds !== null &&
            projects.map((p) => (
              <label key={p.id} className="row small" style={{ gap: "var(--space-2)" }}>
                <input
                  type="checkbox"
                  checked={projectIds.includes(p.id)}
                  onChange={(e) => setProjectIds(e.target.checked ? [...projectIds, p.id] : projectIds.filter((x) => x !== p.id))}
                />
                {p.name}
              </label>
            ))}
        </fieldset>
      )}
    </div>
  );
}

function EditAccess({
  member,
  projects,
  onSaved,
  onCancel,
}: {
  member: Entry;
  projects: ProjectOption[];
  onSaved: (msg: string, error?: boolean) => void;
  onCancel: () => void;
}) {
  const [role, setRole] = useState<Assignable>(member.role === "owner" ? "admin" : member.role);
  const [projectIds, setProjectIds] = useState<string[] | null>(member.projectIds);
  return (
    <div className="stack" data-testid="team-access-editor">
      <AccessFields role={role} setRole={setRole} projectIds={projectIds} setProjectIds={setProjectIds} projects={projects} idPrefix="edit" />
      <div className="row" style={{ gap: "var(--space-2)" }}>
        <button
          type="button"
          className="small"
          onClick={async () => {
            const res = await fetch("/api/admin/team", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: member.email, role, projectIds: role === "admin" ? null : projectIds }),
            });
            const body = await res.json().catch(() => ({}));
            onSaved(res.ok ? `${member.email} is now ${ROLE_NAME[role].toLowerCase()}.` : body.error, !res.ok);
          }}
        >
          Save access
        </button>
        <button type="button" className="ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);

/** Settings → Team: who can sign in, and (for the owner) invitations. */
export function Team({
  you,
  canInvite,
  emailOn,
  roles = false,
  projects = [],
}: {
  you: { email: string; role: Role };
  canInvite: boolean;
  emailOn: boolean;
  /** TEAM-01 (flag team2): roles and per-project access. */
  roles?: boolean;
  projects?: ProjectOption[];
}) {
  const [team, setTeam] = useState<Entry[]>([]);
  const [role, setRole] = useState<Assignable>("admin");
  const [projectIds, setProjectIds] = useState<string[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "a deleted project";
  const [domains, setDomains] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<{ text: string; link?: string; error?: boolean } | null>(null);
  const owner = you.role === "owner";

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/team");
    if (!res.ok) return;
    const body = await res.json();
    setTeam(body.team);
    setDomains(body.domains);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function call(url: string, init: RequestInit) {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    return { ok: res.ok, body: await res.json().catch(() => ({})) };
  }

  function sentMessage(to: string, body: { sent?: boolean; link?: string; error?: string }) {
    if (body.error) return { text: body.error, error: true };
    return body.sent
      ? { text: `Invitation sent to ${to}. The link works for 72 hours.` }
      : { text: `Email isn't set up, so send ${to} this invitation link yourself (it works once, for 72 hours):`, link: body.link };
  }

  return (
    <section className="panel" aria-labelledby="team-h" data-testid="team">
      <div className="panel-head">
        <h2 id="team-h" style={{ fontSize: "var(--text-base)" }}>
          Team
        </h2>
      </div>
      <div className="panel-body stack">
        <p className="muted small">
          {roles
            ? "Admins can use the whole dashboard; editors and viewers only what their role allows, in their projects. Only the owner can invite, remove and change people."
            : "Everyone here can use the whole dashboard. Only the owner can invite and remove people."}
          {domains.length > 0 && <> Anyone with a verified address at {domains.join(", ")} can also sign in.</>}
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Who</th>
                <th>Role</th>
                <th>Status</th>
                <th>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.email} data-testid="team-member" data-email={m.email}>
                  <td>
                    {m.name ? (
                      <>
                        {m.name}
                        <br />
                        <span className="muted small">{m.email}</span>
                      </>
                    ) : (
                      m.email
                    )}
                    {m.email === you.email && <span className="muted small"> (you)</span>}
                  </td>
                  <td data-testid="team-role">
                    {roles ? ROLE_NAME[m.role] : m.access === "owner" ? "Owner" : "Admin"} ({SOURCE[m.access]})
                    {roles && m.projectIds && (
                      <span className="muted small" style={{ display: "block" }}>
                        {m.projectIds.length ? m.projectIds.map(projectName).join(", ") : "No projects yet"}
                      </span>
                    )}
                    {editing === m.email && (
                      <EditAccess
                        member={m}
                        projects={projects}
                        onCancel={() => setEditing(null)}
                        onSaved={async (text, error) => {
                          setMessage({ text, error });
                          if (!error) setEditing(null);
                          await load();
                        }}
                      />
                    )}
                  </td>
                  <td className="muted small">
                    {m.lastSignInAt
                      ? `Last signed in ${when(m.lastSignInAt)}`
                      : m.access === "invited" && !m.activatedAt
                        ? "Invited, not signed in yet"
                        : "Not signed in yet"}
                  </td>
                  <td>
                    {owner && roles && m.access !== "owner" && editing !== m.email && (
                      <button type="button" className="ghost small" onClick={() => setEditing(m.email)} aria-label={`Change access for ${m.email}`}>
                        Change access
                      </button>
                    )}
                    {owner && m.access === "invited" && m.id && (
                      <div className="row" style={{ justifyContent: "flex-end", gap: "var(--space-2)" }}>
                        {!m.activatedAt && (
                          <button
                            type="button"
                            className="ghost small"
                            onClick={async () => {
                              const res = await call(`/api/admin/team/${m.id}/invite`, { method: "POST" });
                              setMessage(res.ok ? sentMessage(m.email, res.body) : { text: res.body.error, error: true });
                            }}
                          >
                            Resend invite
                          </button>
                        )}
                        <button
                          type="button"
                          className="ghost small"
                          aria-label={`Remove ${m.email}`}
                          onClick={async () => {
                            if (!confirm(`Remove ${m.email}? They'll be signed out straight away.`)) return;
                            const res = await call(`/api/admin/team/${m.id}`, { method: "DELETE" });
                            setMessage(res.ok ? { text: `Removed ${m.email}.` } : { text: res.body.error, error: true });
                            await load();
                          }}
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {owner && (
          <form
            className="row"
            style={{ alignItems: "end" }}
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await call("/api/admin/team", {
                method: "POST",
                body: JSON.stringify({ email, ...(roles ? { role, projectIds: role === "admin" ? null : projectIds } : {}) }),
              });
              setMessage(res.ok ? sentMessage(res.body.member.email, res.body) : { text: res.body.error, error: true });
              if (res.ok) setEmail("");
              await load();
            }}
          >
            <label style={{ flex: "1 1 16rem" }}>
              Invite someone by email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
            </label>
            {roles && (
              <AccessFields role={role} setRole={setRole} projectIds={projectIds} setProjectIds={setProjectIds} projects={projects} idPrefix="invite" />
            )}
            <button type="submit">Send invitation</button>
          </form>
        )}
        {owner && !canInvite && (
          <p className="notice warn">
            Invited people sign in with an email link, Google, Apple or single sign-on, and none of those is on yet. Only the owner can use the password. See
            docs/AUTH.md.
          </p>
        )}
        {owner && canInvite && !emailOn && <p className="muted small">Email isn&apos;t set up, so you&apos;ll get each invitation link to send yourself.</p>}
        {message && (
          <div className={message.error ? "notice warn" : "notice"} role={message.error ? "alert" : "status"} data-testid="team-message">
            <p>{message.text}</p>
            {message.link && <p className="secret">{message.link}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
