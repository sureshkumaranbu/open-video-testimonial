import Link from "next/link";
import { auditFacets, listAudit } from "@/lib/audit";
import { requireFeature } from "@/lib/features";
import { requireRolePage } from "@/lib/server-session";
import { listProjects } from "@/lib/testimonials";
import { AppBar } from "../../AppBar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };

const PAGE = 50;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Plain words for the actions the log records. */
const ACTION_LABELS: Record<string, string> = {
  "testimonial.approve": "Approved a testimonial",
  "testimonial.reject": "Rejected a testimonial",
  "testimonial.hide": "Hid a testimonial",
  "testimonial.pending": "Moved a testimonial back to pending",
  "testimonial.edit": "Edited a testimonial",
  "testimonial.tag": "Retagged a testimonial",
  "testimonial.status": "Changed a testimonial's status",
  "testimonial.create": "Added a testimonial",
  "testimonial.delete": "Deleted a testimonial for good",
  "testimonial.trash": "Moved a testimonial to the trash",
  "testimonial.restore": "Restored a testimonial",
  "export.zip": "Exported a project (.zip)",
  "export.csv": "Exported testimonials (CSV)",
  "export.json": "Exported testimonials (JSON)",
  "project.delete": "Deleted a project",
  "project.slug": "Changed a project's link",
  "member.invite": "Invited someone",
  "member.access": "Changed someone's role or projects",
  "member.remove": "Removed someone",
  "api_key.create": "Created an API key",
  "api_key.revoke": "Revoked an API key",
  "webhook.create": "Added a webhook",
  "webhook.update": "Changed a webhook",
  "webhook.delete": "Deleted a webhook",
  "campaign.start": "Started a campaign",
  "campaign.pause": "Paused a campaign",
  "campaign.delete": "Deleted a campaign",
  "trigger.create": "Added a Stripe or Shopify trigger",
  "trigger.update": "Changed a Stripe or Shopify trigger",
  "trigger.delete": "Deleted a Stripe or Shopify trigger",
  "oauth.grant": "Connected an AI assistant (MCP)",
  "oauth.revoke": "Disconnected an AI assistant (MCP)",
};
const label = (action: string) => ACTION_LABELS[action] ?? (action.startsWith("testimonial.bulk.") ? `Bulk action: ${action.slice(17)}` : action);

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 200) : "");

/** TEAM-02: who did what, filterable by action, person, project and dates. Admins only. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireRolePage("admin");
  requireFeature("team2");
  const sp = await searchParams;
  const f = { action: one(sp.action), actor: one(sp.actor), project: one(sp.project), from: one(sp.from), to: one(sp.to) };
  const offset = Math.max(Number(one(sp.offset)) || 0, 0);
  const { rows, total } = listAudit(
    {
      action: f.action || null,
      actor: f.actor || null,
      projectId: f.project || null,
      from: DAY.test(f.from) ? f.from : null,
      to: DAY.test(f.to) ? f.to : null,
    },
    { limit: PAGE, offset },
  );
  const { actions, actors } = auditFacets();
  const projects = listProjects();
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const query = (extra: Record<string, string | number>) => {
    const all: Record<string, string | number> = { ...f, ...extra };
    const q = new URLSearchParams(
      Object.entries(all)
        .filter(([, v]) => v !== "" && v !== 0)
        .map(([k, v]) => [k, String(v)]),
    );
    return q.toString() ? `?${q}` : "";
  };
  return (
    <>
      <AppBar trail={[{ href: "/admin/settings", label: "Settings" }, { label: "Audit log" }]} />
      <main className="container stack-lg">
        <div className="page-head">
          <div>
            <h1>Audit log</h1>
            <p className="muted">Who approved, edited, deleted or exported what, and every change to the team, API keys, webhooks and connected assistants.</p>
          </div>
          <a className="button secondary small" href={`/api/admin/audit${query({ format: "csv" })}`} data-testid="audit-csv">
            Download CSV
          </a>
        </div>
        <form method="get" className="panel panel-body row" style={{ alignItems: "end", flexWrap: "wrap" }} data-testid="audit-filters">
          <label>
            Action
            <select name="action" defaultValue={f.action}>
              <option value="">Any</option>
              <option value="testimonial.">Any testimonial change</option>
              <option value="export.">Any export</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {label(a)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Who
            <select name="actor" defaultValue={f.actor}>
              <option value="">Anyone</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Project
            <select name="project" defaultValue={f.project}>
              <option value="">Any</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input type="date" name="from" defaultValue={f.from} />
          </label>
          <label>
            To
            <input type="date" name="to" defaultValue={f.to} />
          </label>
          <button type="submit">Filter</button>
          {Object.values(f).some(Boolean) && (
            <Link href="/admin/settings/audit" className="button ghost">
              Clear
            </Link>
          )}
        </form>
        <section className="panel">
          {rows.length === 0 ? (
            <p className="panel-body muted" data-testid="audit-empty">
              {total === 0 && !Object.values(f).some(Boolean)
                ? "Nothing yet. Approvals, edits, exports and team changes appear here."
                : "Nothing matches these filters."}
            </p>
          ) : (
            <div className="table-wrap">
              <table data-testid="audit-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>What</th>
                    <th>Project</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} data-testid="audit-row" data-action={r.action}>
                      <td className="small">
                        <time dateTime={r.at.toISOString()}>{r.at.toISOString().replace("T", " ").slice(0, 16)} UTC</time>
                      </td>
                      <td className="small">{r.actorLabel}</td>
                      <td>
                        {label(r.action)}
                        {r.summary && (
                          <span className="muted small" style={{ display: "block" }}>
                            {r.summary}
                          </span>
                        )}
                      </td>
                      <td className="small">{r.projectId ? (projectName.get(r.projectId) ?? "A deleted project") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {total > PAGE && (
          <nav className="row" aria-label="Pages" style={{ justifyContent: "space-between" }}>
            <span className="muted small">
              {offset + 1}–{Math.min(offset + PAGE, total)} of {total.toLocaleString("en")}
            </span>
            <span className="row">
              {offset > 0 && (
                <Link className="button ghost small" href={`/admin/settings/audit${query({ offset: Math.max(offset - PAGE, 0) })}`}>
                  Newer
                </Link>
              )}
              {offset + PAGE < total && (
                <Link className="button ghost small" href={`/admin/settings/audit${query({ offset: offset + PAGE })}`}>
                  Older
                </Link>
              )}
            </span>
          </nav>
        )}
      </main>
    </>
  );
}
