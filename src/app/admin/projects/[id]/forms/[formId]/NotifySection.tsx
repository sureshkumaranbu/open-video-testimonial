"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/admin/api";
import "@/app/admin/notifications.css";

type Channel = { id: string; name: string; type: string; projectId: string | null; formIds: string[]; active: boolean };
type Choice = "all" | string[];

const LABELS: Record<string, string> = { slack: "Slack", discord: "Discord", teams: "Teams", telegram: "Telegram" };

/**
 * Which chat channels hear about this form's testimonials (INT-02 "per form
 * choose channel"). The choice is part of the form's settings, saved with the
 * rest of the builder. Channels themselves are set up in Settings.
 */
export function NotifySection({
  projectId,
  formId,
  value,
  onChange,
}: {
  projectId: string;
  formId: string;
  value: Choice;
  onChange: (next: Choice) => void;
}) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ channels: Channel[] }>(`/api/admin/notification-channels?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => setChannels(r.channels.filter((c) => !c.formIds.length || c.formIds.includes(formId))))
      .catch((e) => setError((e as Error).message));
  }, [projectId, formId]);

  const all = value === "all";
  const chosen = all ? [] : value;

  return (
    <fieldset className="fb-fieldset" data-testid="form-notify">
      <legend>Chat notifications</legend>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {channels && channels.length === 0 ? (
        <p className="muted xsmall">
          No chat channels yet. Add Slack, Discord, Teams or Telegram in <a href="/admin/settings#notifications">Settings → Notifications</a>.
        </p>
      ) : (
        <div className="nt-notify-list">
          <label className="check small">
            <input type="radio" name={`notify-${formId}`} checked={all} onChange={() => onChange("all")} />
            Every channel for this project
          </label>
          <label className="check small">
            <input type="radio" name={`notify-${formId}`} checked={!all} onChange={() => onChange([])} />
            Only the channels I tick (none ticked = no chat messages)
          </label>
          {!all &&
            (channels ?? []).map((c) => (
              <label key={c.id} className="check small" style={{ paddingLeft: "var(--space-4)" }}>
                <input
                  type="checkbox"
                  checked={chosen.includes(c.id)}
                  onChange={(e) => onChange(e.target.checked ? [...chosen, c.id] : chosen.filter((id) => id !== c.id))}
                />
                {c.name} <span className="muted xsmall">({LABELS[c.type] ?? c.type}{c.active ? "" : ", paused"})</span>
              </label>
            ))}
        </div>
      )}
    </fieldset>
  );
}
