"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

type Entry = {
  id: string | null;
  email: string;
  name: string | null;
  role: "owner" | "admin";
  access: "owner" | "admin-emails" | "domain" | "invited";
  activatedAt: string | null;
  lastSignInAt: string | null;
};

const ACCESS: Record<Entry["access"], string> = {
  owner: "Owner (ADMIN_EMAIL)",
  "admin-emails": "Admin (ADMIN_EMAILS)",
  domain: "Admin (allowed domain)",
  invited: "Admin (invited)",
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);

/** Settings → Team: who can sign in, and (for the owner) invitations. */
export function Team({ you, canInvite, emailOn }: { you: { email: string; role: "owner" | "admin" }; canInvite: boolean; emailOn: boolean }) {
  const [team, setTeam] = useState<Entry[]>([]);
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
          Everyone here can use the whole dashboard. Only the owner can invite and remove people.
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
                  <td>{ACCESS[m.access]}</td>
                  <td className="muted small">
                    {m.lastSignInAt ? `Last signed in ${when(m.lastSignInAt)}` : m.access === "invited" && !m.activatedAt ? "Invited, not signed in yet" : "Not signed in yet"}
                  </td>
                  <td>
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
              const res = await call("/api/admin/team", { method: "POST", body: JSON.stringify({ email }) });
              setMessage(res.ok ? sentMessage(res.body.member.email, res.body) : { text: res.body.error, error: true });
              if (res.ok) setEmail("");
              await load();
            }}
          >
            <label style={{ flex: "1 1 16rem" }}>
              Invite someone by email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
            </label>
            <button type="submit">Send invitation</button>
          </form>
        )}
        {owner && !canInvite && (
          <p className="notice warn">
            Invited people sign in with an email link, Google, Apple or single sign-on, and none of those is on yet. Only the owner can use the password. See docs/AUTH.md.
          </p>
        )}
        {owner && canInvite && !emailOn && (
          <p className="muted small">Email isn&apos;t set up, so you&apos;ll get each invitation link to send yourself.</p>
        )}
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
